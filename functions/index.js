const functions = require('firebase-functions');
const admin = require('firebase-admin');
const request = require('superagent');
const sgMail = require('@sendgrid/mail');

const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

if (IS_DEVELOPMENT) {
  console.info('THIS IS DEVELOPMENT');
}

const TRIVIA_API_URL = 'http://jservice.io/api/category';
const FOOD = 49;
const THREE_LETTER_WORDS = 105;
const FOOD_FOR_THOUGHT = 6588;
const ANIMAL = 21;

const CATEGORIES = [FOOD, THREE_LETTER_WORDS, FOOD_FOR_THOUGHT, ANIMAL];
const fromEmail = 'mirum@ryanly.ca';

admin.initializeApp(functions.config().firebase);
const app = admin.app();
const database = IS_DEVELOPMENT
  ? app.database('https://mirum-50b54-f4f3b.firebaseio.com/')
  : app.database();

sgMail.setApiKey(functions.config().sendgrid_api.key);

function titleCase(str) {
  return str.toLowerCase()
    .split(' ')
    .map(word => word.replace(word[0], word[0].toUpperCase()))
    .join(' ');
}

exports.daily_job =
  functions.pubsub.topic('daily-tick').onPublish(() => database.ref('profile').once('value')
    .then((snapshot) => {
      const profile = snapshot.val();
      const values = Object.keys(profile).map(key => profile[key]);
      const emails = values.map(profileValue => profileValue.preferred_email);

      return request
        .get(TRIVIA_API_URL)
        .query({
          id: CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)],
        })
        .then(({ body }) => {
          const category = titleCase(body.title);
          const numClues = body.clues.length;
          let clue;
          let question;
          let answer;

          while (!question || !answer) {
            clue = body.clues[Math.floor(Math.random() * numClues)];
            ({ answer, question } = clue);
          }
          console.info(`Question (${category}): ${question}, Answer: ${answer}`);

          database.ref('question').push(Object.assign(clue, {
            timestamp: admin.database.ServerValue.TIMESTAMP,
            category,
          }));

          const msg = {
            to: emails,
            from: fromEmail,
            subject: '[Mirum] Question of the Day',
            text: `Here's the question of the day (Category: '${category}'): ${question}? Answer at https://mirum.ryanly.ca!`,
            html: `<strong>Here's the question of the day (Category: '${category}'):</strong> ${question}?<br><br>` +
                  'Answer at <a href="https://mirum.ryanly.ca">mirum.ryanly.ca</a>!',
          };

          if (!IS_DEVELOPMENT) {
            return sgMail.sendMultiple(msg);
          }

          return null;
        })
        .then(() => {
          console.info(`Emails sent from ${fromEmail} to ${emails.join(', ')}!`);
          return {
            success: true,
          };
        });
    })
    .catch((error) => {
      console.info('Error listing users:', error);
      return {
        success: false,
      };
    }));

exports.notify_changes = functions.database.ref('/table/{table_id}')
  .onWrite((change) => {
    const { after, before } = change;

    // Creation
    if (!before.exists()) {
      console.info('Table Entry added');
      const tableRow = after.val();
      return database.ref(`profile/${tableRow.user_id}`).once('value').then((profile) => {
        const msg = {
          to: profile.val().preferred_email,
          from: fromEmail,
          subject: '[Mirum] You were given points!',
          text: `You were given ${tableRow.points} points!Take a look at https://mirum.ryanly.ca!`,
          html: `You were given <strong>${tableRow.points}</strong> points for <i>${tableRow.reason}</i>!<br><br>` +
                'Take a look at <a href="https://mirum.ryanly.ca">mirum.ryanly.ca</a>!',
        };
        return sgMail.send(msg);
      });
    } else if (!after.exists()) {
      // Deletion
      console.error(`Table Entry deleted! ${JSON.stringify(before.val())}`);
    } else {
      console.info('Table Entry updated');
      const tableRowBefore = before.val();
      const tableRowAfter = after.val();
      const userIds = Array.from(new Set([tableRowBefore.user_id, tableRowAfter.user_id]));

      const promises = userIds.map(userId => database.ref(`profile/${userId}`).once('value'));
      return Promise.all(promises).then((profiles) => {
        const profileObj = profiles.reduce((obj, profile) => {
          obj[profile.key] = profile.val(); // eslint-disable-line no-param-reassign
          return obj;
        }, {});

        // Firebase does not support Object.values
        const values = Object.keys(profileObj).map(key => profileObj[key]);
        values.forEach((profile) => {
          const msg = {
            to: profile.preferred_email,
            from: fromEmail,
            subject: '[Mirum] Points update!',
            text: 'A row was updated! Take a look at https://mirum.ryanly.ca!',
            html: 'A row was updated!<br>' +
              `Points: ${tableRowBefore.points} -> ${tableRowAfter.points}<br>` +
              `Reason: ${tableRowBefore.reason} -> ${tableRowAfter.reason}<br>` +
              `User: ${profileObj[tableRowBefore.user_id].name} -> ${profileObj[tableRowAfter.user_id].name}<br>` +
              '<br>Take a look at <a href="https://mirum.ryanly.ca">mirum.ryanly.ca</a>!',
          };
          return sgMail.send(msg);
        });
      });
    }
    return {
      success: false,
    };
  });

exports.proposal_created = functions.database.ref('/proposal/{proposal_id}')
  .onCreate((snapshot, context) => {
    const proposal = snapshot.val();
    const proposalId = context.params.proposal_id;

    // Creation
    console.info('Proposal Created');
    return database.ref('profile').once('value')
      .then((profiles) => {
        const profile = profiles.val();
        const profileKeys = Object.keys(profile);

        const updates = {};
        profileKeys.forEach((profileKey) => {
          updates[`proposal_detail/${proposalId}/approval/${profileKey}`] = false;
          updates[`proposal_detail/${proposalId}/complete/${profileKey}`] = false;
        });
        database.ref().update(updates);

        const values = profileKeys.filter(keys => keys !== proposal.proposed_by).map(key => profile[key]);
        const emails = values.map(profileValue => profileValue.preferred_email);
        const msg = {
          to: emails,
          from: fromEmail,
          subject: '[Mirum] New Proposal',
          text: 'There\'s a new proposal! Take a look at https://mirum.ryanly.ca!',
          html: `There's a new proposal worth <strong>${proposal.points}</strong> points for <i>${proposal.reason}</i>!<br><br>` +
                'Take a look at <a href="https://mirum.ryanly.ca">mirum.ryanly.ca</a>!',
        };
        return sgMail.sendMultiple(msg);
      });
  });

exports.proposal_detail_updated = functions.database.ref('/proposal_detail/{proposal_id}/approval/')
  .onWrite((change, context) => {
    const { after } = change;
    const approvals = after.val();
    const proposalId = context.params.proposal_id;

    console.info('Proposal Detail Updated');
    const userIds = Object.keys(approvals);
    const approvalValues = userIds.map(userId => approvals[userId]);
    const isAllApproved = approvalValues
      .every(proposalDetail => proposalDetail === true);

    if (isAllApproved) {
      const updates = {};
      updates[`proposal/${proposalId}/approved_at`] = admin.database.ServerValue.TIMESTAMP;
      // There is a race condition. Set this again
      userIds.forEach((userId) => {
        updates[`proposal_detail/${proposalId}/approval/${userId}`] = true;
      });
      database.ref().update(updates);

      return database.ref('profile').once('value')
        .then((profiles) => {
          const profile = profiles.val();
          const profileKeys = Object.keys(profile);
          const values = profileKeys.map(key => profile[key]);
          const emails = values.map(profileValue => profileValue.preferred_email);

          const msg = {
            to: emails,
            from: fromEmail,
            subject: '[Mirum] Proposal Approved!',
            text: 'Everyone has approved the proposal! Take a look at https://mirum.ryanly.ca!',
            html: 'Everyone has approved the proposal!' +
            'Take a look at <a href="https://mirum.ryanly.ca">mirum.ryanly.ca</a>!',
          };

          return sgMail.sendMultiple(msg)
            .then(() => {
              console.info(`Emails sent from ${fromEmail} to ${emails.join(', ')}!`);
              return { success: true };
            });
        });
    }

    return { success: false };
  });

exports.on_user_creation = functions.auth.user().onCreate((user) => {
  database.ref(`profile/${user.uid}`).push({
    name: user.displayName,
    preferred_email: user.email,
  });
});
