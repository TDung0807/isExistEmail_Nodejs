// app.js
const fs = require('fs');
const csv = require('csv-parser');
const fastCsv = require('fast-csv');
const Verify = require('./Verify');

async function processCsv(filePath) {
    const results = [];

    const validStream = fs.createWriteStream('output/valid.csv');
    const invalidStream = fs.createWriteStream('output/invalid.csv');
    const undetifiedStream = fs.createWriteStream('output/undetified.csv');

    const validCsvStream = fastCsv.format({ headers: true });
    const invalidCsvStream = fastCsv.format({ headers: true });
    const undetifiedCsvStream = fastCsv.format({ headers: true });

    validCsvStream.pipe(validStream);
    invalidCsvStream.pipe(invalidStream);
    undetifiedCsvStream.pipe(undetifiedStream);

    // Read CSV file and accumulate results
    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            try {
                console.log('Processing results...');
                processResults();
                console.log('End of initial processing.');
                retryUndeterminedEmails();
                console.log('Completed retry process.');
            } catch (error) {
                console.error('Error processing CSV file:', error);
            }
        })
        .on('error', (error) => {
            console.error('Error reading CSV file:', error);
        });

    async function processResults() {
        const emailVerificationPromises = results.map(async (row) => {
            const email = row.email;
            try {
                const result = await Verify.verifyEmail(email);
                if (result === 'existent') {
                    console.log("1")
                    validCsvStream.write({ email });
                } else if (result === 'nonexistent') {
                    console.log("2")
                    invalidCsvStream.write({ email });
                } else if (result === 'undetified') {
                    console.log("3")
                    undetifiedCsvStream.write({ email });
                }
            } catch (error) {
                undetifiedCsvStream.write({ email });
            }
        });

        await Promise.all(emailVerificationPromises);
        console.log("End");

        // End the CSV streams
        validCsvStream.end();
        invalidCsvStream.end();
        undetifiedCsvStream.end();
    }

    async function retryUndeterminedEmails() {
        console.log("-------------------Start step 2-------------------");
        const undetifiedFilePath = 'output/undetified.csv';

        const countUndeterminedEmails = async () => {
            return new Promise((resolve, reject) => {
                let count = 0;
                fs.createReadStream(undetifiedFilePath)
                    .pipe(csv())
                    .on('data', () => count++)
                    .on('end', () => resolve(count))
                    .on('error', reject);
            });
        };

        let previousCount = 0;
        let currentCount = 0;

        while (true) {
            previousCount = await countUndeterminedEmails();

            if (previousCount < 3) {
                console.log('No more undetermined emails or fewer than 3 entries. Exiting retry process.');
                break;
            }

            const undetifiedEmails = [];
            await new Promise((resolve, reject) => {
                fs.createReadStream(undetifiedFilePath)
                    .pipe(csv())
                    .on('data', (data) => undetifiedEmails.push(data))
                    .on('end', resolve)
                    .on('error', reject);
            });

            const retryPromises = undetifiedEmails.map(async (row) => {
                const email = row.email;
                try {
                    const result = await Verify.verifyEmail(email);
                    const updatedResult = (result === 'existent') ? validCsvStream : (result === 'nonexistent') ? invalidCsvStream : undetifiedCsvStream;
                    updatedResult.write({ email });
                } catch (error) {
                    undetifiedStream.write({ email });
                }
            });

            await Promise.all(retryPromises);

            // Clear the undetermined file for the next iteration
            await new Promise((resolve, reject) => {
                fs.truncate(undetifiedFilePath, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            currentCount = await countUndeterminedEmails();

            // Exit if the number of undetermined emails did not change enough
            if (Math.abs(previousCount - currentCount) < 3) {
                console.log('Difference in undetermined email count is less than 3. Exiting retry process.');
                break;
            }
        }
    }
}

const filePath = './content/clean.csv';
processCsv(filePath);
