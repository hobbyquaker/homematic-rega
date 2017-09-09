const Rega = require('./index.js');

const rega = new Rega({host: '172.16.23.130'});

rega.exec('string x = "Hello";\nWriteLine(x # " World!");', (err, output, objects) => {
    if (err) {
        throw err;
    }
    console.log('Output:', output);
    console.log('Objects:', objects);
});