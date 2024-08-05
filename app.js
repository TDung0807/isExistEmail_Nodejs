const fs = require('fs');
const csv = require('csv-parser');
const fastCsv = require('fast-csv');
const dns = require('dns');
const net = require('net');

async function verifyEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return 'invalid';
    }

    const domain = email.split('@')[1];

    try {
        const mxRecords = await new Promise((resolve, reject) => {
            dns.resolveMx(domain, (err, addresses) => {
                if (err) reject(err);
                else resolve(addresses);
            });
        });

        if (mxRecords.length === 0) {
            return 'nonexistent';
        }

        mxRecords.sort((a, b) => a.priority - b.priority);

        const connectToMx = (mx) => {
            return new Promise((resolve, reject) => {
                const client = net.createConnection(25, mx.exchange);
                let stage = 0;

                client.on('error', (err) => {
                    reject(err);
                });

                client.on('data', (data) => {
                    const response = data.toString();

                    if (stage === 0 && response.startsWith('220')) {
                        client.write(`HELO ${domain}\r\n`);
                        stage++;
                    } else if (stage === 1 && response.startsWith('250')) {
                        client.write(`MAIL FROM:<verify@${domain}>\r\n`);
                        stage++;
                    } else if (stage === 2 && response.startsWith('250')) {
                        client.write(`RCPT TO:<${email}>\r\n`);
                        stage++;
                    } else if (stage === 3) {
                        if (response.startsWith('250')) {
                            client.end();
                            resolve('existent');
                        } else if (response.startsWith('550') || response.includes('5.1.1')) {
                            if (response.includes('5.7.1')) {
                                client.end();
                                resolve('undetified');
                            } else {
                                client.end();
                                resolve('nonexistent');
                            }
                        }
                    } else if (response.startsWith('220') || response.startsWith('250')) {
                        if (stage === 0) {
                            client.write(`HELO ${domain}\r\n`);
                        } else if (stage === 1) {
                            client.write(`MAIL FROM:<verify@${domain}>\r\n`);
                        } else if (stage === 2) {
                            client.write(`RCPT TO:<${email}\r\n`);
                        }
                    } else {
                        if (response.includes('5.7.1')) {
                            client.end();
                            resolve('undetified');
                        } else {
                            client.end();
                            resolve('nonexistent');
                        }
                    }
                });

                client.on('end', () => {
                    if (stage !== 3) {
                        resolve('nonexistent');
                    }
                });
            });
        };

        for (const mx of mxRecords) {
            try {
                const result = await connectToMx(mx);
                if (result === 'existent' || result === 'undetified') {
                    return result;
                }
            } catch (err) {
            }
        }

        return 'nonexistent';

    } catch (error) {
        console.log('Error resolving MX records:', error);
        return 'nonexistent';
    }
}

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
    
    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            const emailVerificationPromises = results.map(async (row) => {
                const email = row.email;
                try {
                    const result = await verifyEmail(email);
                    if (result === 'existent') {
                        validCsvStream.write({ email });
                    } else if (result === 'nonexistent') {
                        invalidCsvStream.write({ email });
                    } else if (result === 'undetified') {
                        undetifiedCsvStream.write({ email });
                    }
                } catch (error) {
                    console.error(`Error verifying email ${email}:`);
                    undetifiedCsvStream.write({ email });
                }
            });

            await Promise.all(emailVerificationPromises);

            validCsvStream.end();
            invalidCsvStream.end();
            undetifiedCsvStream.end();
        });
}

const filePath = './content/acb.csv';
processCsv(filePath);
