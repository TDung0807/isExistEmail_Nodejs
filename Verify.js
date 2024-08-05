// Verify.js
const dns = require('dns');
const net = require('net');

class Verify {
    static async verifyEmail(email) {
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

            const connectToMx = async (mx, retries = 3) => {
                return new Promise((resolve, reject) => {
                    const client = net.createConnection(25, mx.exchange);
                    let stage = 0;

                    client.on('error', (err) => {
                        if (err.code === 'ETIMEOUT' && retries > 0) {
                            resolve(connectToMx(mx, retries - 1));
                        } else {
                            reject(err);
                        }
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
            return 'nonexistent';
        }
    }
}

module.exports = Verify;
