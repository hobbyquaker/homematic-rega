const Rega = require('./index.js');
const rega = new Rega({host: 'homematic-raspi', disableTranslation: false});


/*
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

            rega.getFunctions((err, res) => {
                console.log('getFunctions', err, res);

                rega.getPrograms((err, res) => {
                    console.log('getPrograms', err, res);

                    rega.getChannels((err, res) => {
                        console.log('getChannels', err, res);
                    });

                });

            });

        });

    });

});
*/

rega.getVariables((err, res) => {
    console.log('getVariables', err, res);
});
