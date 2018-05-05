const Rega = require('./index.js');
const rega = new Rega({host: '172.16.23.175', disableTranslation: false});

rega.exec('string x = "Hello";\nWriteLine(x # " World!");', (err, output, objects) => {
    if (err) {
        throw err;
    }
    console.log('Script Output:', output);
    console.log('Script Objects:', objects);

    rega.getVariables((err, res) => {
        console.log('getVariables', err, res);

        rega.getRooms((err, res) => {
            console.log('getRooms', err, res);
        });

    });

});
