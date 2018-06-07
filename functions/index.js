const functions = require('firebase-functions');
const admin = require('firebase-admin');
const request = require('superagent');

const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';
const FAKE_FIREBASE_USERS = [
  {
    email: 'ryan@ryanly.ca',
  },
];
const TRIVIA_API_URL = 'http://jservice.io/api/category';
const FOOD_CATEGORY = 49;

const fromEmail = 'ryan@ryanly.ca';
const sgMail = require('@sendgrid/mail');

admin.initializeApp(functions.config().firebase);
const database = admin.database();
sgMail.setApiKey(functions.config().sendgrid_api.key);

exports.daily_job =
  functions.pubsub.topic('daily-tick').onPublish(() => admin.auth().listUsers(100)
    .then((listUsersResult) => {
      const emails = (
        IS_DEVELOPMENT
          ? FAKE_FIREBASE_USERS
          : listUsersResult.users
      ).map(userRecord => userRecord.email);

      return request
        .get(TRIVIA_API_URL)
        .query({
          id: FOOD_CATEGORY,
        })
        .then(({ body }) => {
          const numClues = body.clues.length;
          const clue = body.clues[Math.floor(Math.random() * numClues)];
          const { question } = clue;

          database.ref('question').push(Object.assign(clue, {
            timestamp: admin.database.ServerValue.TIMESTAMP,
          }));

          const msg = {
            to: emails,
            from: fromEmail,
            subject: '[Mirum] Question of the Day',
            text: `Here's the question of the day (Category: Food): ${question}? Answer at mirum.ryanly.ca!`,
            html: `<strong>Here's the question of the day (Category: Food):</strong> ${question}?<br><br>Answer at <a href="https://mirum.ryanly.ca">mirum.ryanly.ca</a>!`,
          };
          return sgMail.sendMultiple(msg);
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
