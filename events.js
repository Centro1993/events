const http = require('http');
const dispatcher = require('httpdispatcher');
const querystring = require('querystring');
const async = require('async');
const Datastore = require('nedb');
const chalk = require('chalk');
const nodemailer = require('nodemailer');
const fs = require('fs');

//db laden
db = {};
db.users = new Datastore('db/users.db');
db.events = new Datastore('db/events.db');
db.admin = new Datastore('db/admin.db')

db.users.loadDatabase();
db.events.loadDatabase();

//servervariablen
const host = '0.0.0.0';
const port = 3002;
const admin = process.argv[2];
const password = process.argv[3];

//array where admin-logins are stored
var tokenArray = [];

/*------------------------NEDB-FUNKTIONEN----------------------*/
//event in db einfügen
function dbCreateEvent(newEvent, callback) {
    db.events.insert(newEvent, function(err, res) {
        callback(err, res);
    });
}

//alle events finden (um sie auf der website anzuzeigen)
//alternativ nach einer eventid suchen
function dbQueryEvents(eventid, userId, callback) {
    console.log(chalk.blue("Function: dbQueryEvents"));
    if (eventid == 0) {
        db.events.find({}, function(err, docs) {
            console.dir(docs);
            callback(err, docs, userId);
        });
    } else {
        db.events.find({
            _id: eventid
        }, function(err, docs) {
            console.dir(docs[0]);
            callback(err, docs[0], userId);
        });
    }
}

//user in usercollection einfügen
function dbInsertUser(user, eventId, callback) {
    console.log(chalk.blue("Function: dbInsertUser()"));
    db.users.insert(user, function(err, res) {
        callback(err, eventId, res);
    });
}

//user finden
function dbQueryUser(eventId, userId, callback) {
    console.log(chalk.blue("Function: dbQueryUser()"));
    console.log(typeof userId);
    //entweder eine userId suchen, oder user als objekt bekommen und nach email suchen
    if (typeof userId === "string") {
        console.log("Got an ID");
        db.users.find({
            _id: userId
        }, function(err, docs) {
            console.dir(docs[0]);
            callback(err, docs[0], eventId);
        });
    } else {
        console.log("Not an ID");
        db.users.find({
            email: userId.email
        }, function(err, docs) {
            console.dir(docs[0]);
            callback(err, docs[0], eventId);
        });
    }
}

//checken, ob im event noch platz ist, und emails schicken
function dbProcessSignup(event, user, callback) {
    console.log(chalk.blue("Function: dbProcessSignup"));
    console.dir(event);
    console.dir(user);
    //DEFINITION PARTICIPANT
    var participant = {
        _id: user['_id'],
        verified: false,
        inviteSent: false,
        timestamp: new Date()
    }

    console.dir(participant);

    //nach freien plätzen prüfen
    if (eventCheckPlaces(event) > 0) {
        //email mit bestätigungsanfrage schicken
        sendMail(user['_id'], event['_id'], 1);
        //user als eingeladen markieren
        participant.inviteSent = true;
    } else {
        //wartelistenmail schicken
        sendMail(user['_id'], event['_id'], 3);
    }

    //user in event als unbestätigt eintragen
    event.participants.push(participant);

    //event in db updaten
    db.events.update({
        _id: event['_id']
    }, event, {
        upsert: true
    }, function(err, res) {
        callback(err, res);
    });

}

/*---------------------------FUNKTIONEN----------------*/

//event nach anzahl freier plätze überprüfen
var eventCheckPlaces = function(event) {
    console.log(chalk.blue("Function: eventCheckPlaces()"));
    var reservedPlaces = 0;

    for (var i = 0; i < event.participants.length; i++) {
        if (event.participants[i].verified == true) {
            reservedPlaces++;
        }
        var places = event.maxParticipants - reservedPlaces;
    }
    console.log(chalk.yellow("Freie Plätze: " + places));
    return places;
}

//user verifizieren, warteliste oder bestätigunsmail schicken
var eventVerifyUser = function(event, userId, callback) {
        console.log(chalk.blue("Function: eventVerifyUser()"));
        console.log(chalk.yellow("UserId: " + userId));
        //frei plätze überprüfen
        if (event.maxParticipants >= eventCheckPlaces(event)) {
            //user suchen und verifizieren
            console.log(chalk.yellow("Plätze verfügbar, User wird gesucht..."));
            for (var i = 0; i < event.participants.length; i++) {
                if (event.participants[i]['_id'] == userId) {
                    console.log(chalk.green("UserId " + userId + " verifiziert!"));
                    event.participants[i].verified = true;
                }
            }
            //bestätigunsmail senden
            sendMail(userId, event['_id'], 1);
        } else { //wartelistenmail schicken
            sendMail(userId, event['_id'], 3);
        }
        //event updaten
        db.events.update({
            _id: event['_id']
        }, event, {
            upsert: true
        }, function(err, res) {
            console.log(chalk.yellow("Event updated: " + res));
            callback(err, res);
        });
    }
    //TODO
var eventSignoutUser = function(event, user, callback) {
    /*
      1. freie plätze prüfen
      2. user aus event entfernen
      3. erneut freie plätze prüfen
      4. platzdifferenz errechnen
      5. wenn neuer freier platz, unverifizierten user mit kleinster timestamp einladung schicken
    */
    //1.
    var freePlacesBeforeSignout = eventCheckPlaces(event);

    //2.
    //user suchen und entfernen
    for (var i = 0; i < event.participants.length; i++) {
        if (event.participant[i]['_id'] == userId) {
            event.splice(i, 1);
        }
    }

    //3.
    //warteliste überprüfen
    var freePlacesAfterSignout = eventCheckPlaces(event);

    //4.
    var freePlacesDifference = freePlacesBeforeSignout - freePlacesAfterSignout;

    //5.
    //wenn platz frei
    if (freePlacesDifference > 0) {
        var participantToInvite = null;
        //teilnehmer durchlaufen
        for (var i = 0; i < event.participants.length; i++) {
            //wenn teilnehmer keine email erhalten hat und kein anderer vorhanden ist oder timestamp niedriger, participant einladen
            if (event.participants[i].inviteSent == false && participantToInvite == null) {
                participantToInvite = i;
            } else if (event.participants[i].inviteSent == false && event.participants[i].timestamp < participantToInvite.timestamp) {
                participantToInvite = i;
            }
        }
        //wenn teilnehmer zum einladen vorhanden, email senden und als eingeladen markieren
        if (participantToInvite != null) {
            sendMail(event.participants[participantToInvite], event['_id'], 4);
            event.participants[participantToInvite].inviteSent = true;

            //event in db updaten
            db.events.update({
                _id: event['_id']
            }, event, {
                upsert: true
            }, function(err, res) {
                callback(err, res);
            });

        }
    }
}

//vordefinierte mail an user über event senden
var sendMail = function(userId, eventId, mailType) {
    console.log(chalk.blue("Function: sendMail(), Type: " + mailType));
    //user und event anhand ihrer id's querien, dann mail schreiben
    async.waterfall([
        async.apply(dbQueryEvents, eventId, userId),
        dbQueryUser
    ], function(err, user, event) {
        //prüfen, ob event und user gefunden wurden
        if (typeof user !== "undefined" && typeof event !== "undefined") {
            //mailcode beginnt hier
            var transporter = nodemailer.createTransport({
                // if you do not provide the reverse resolved hostname
                // then the recipients server might reject the connection
                name: 'google.de',
                // use direct sending
                direct: true
            });

            //TODO valle verschiedenen mailtypen in nem switchcase
            switch (mailType) {
                case 1:
                    //verififizierungs-link
                    var verifyLink = "192.168.0.52:3002/verifySignup/&userid=" + user['_id'] + "&eventid=" + event['_id'];
                    //bestätigung eventteilnahme
                    var mailOptions = {
                        from: '"Chaostreff Flensburg" <events@chaostreff-flensburg.de>', // sender address
                        to: user.email, // list of receivers
                        subject: 'Teilnahme an ' + event.name, // Subject line
                        text: 'Hallo ' + user.name + '!', // plaintext body
                        html: '<b>Hallo ' + user.name + '! Um deine Teilnahme am Event ' + event.name + ' zu bestätigen, klicke auf diesen Link: ' + verifyLink + '</b>' // html body
                    };
                    break;

                case 2:
                    //bestätigung signout
                    var mailOptions = {
                        from: '"Chaostreff Flensburg" <events@chaostreff-flensburg.de>', // sender address
                        to: user.email, // list of receivers
                        subject: 'Hello ✔', // Subject line
                        text: 'Hello world 🐴', // plaintext body
                        html: '<b>Hello world 🐴</b>' // html body
                    };
                    break;

                case 3:
                    //wartelistenmail
                    var mailOptions = {
                        from: '"Chaostreff Flensburg" <events@chaostreff-flensburg.de>', // sender address
                        to: user.email, // list of receivers
                        subject: 'Hello ✔', // Subject line
                        text: 'Hello world 🐴', // plaintext body
                        html: '<b>Hello world 🐴</b>' // html body
                    };
                    break;

                case 4:
                    //platz frei geworden
                    var mailOptions = {
                        from: '"Chaostreff Flensburg" <events@chaostreff-flensburg.de>', // sender address
                        to: user.email, // list of receivers
                        subject: 'Hello ✔', // Subject line
                        text: 'Hello world 🐴', // plaintext body
                        html: '<b>Hello world 🐴</b>' // html body
                    };
                    break;
            }

            // send mail with defined transport object
            transporter.sendMail(mailOptions, function(error, info) {
                if (error) {
                    return console.log(error);
                }
                console.log(chalk.green('Message sent: ' + info.response));
            });
        } else {
            console.log(chalk.red("Email nicht geschickt, User oder Event nicht gefunden!"));
        }
    });
}

/*----------------------TOKEN-MANGAER---------------------------*/

//definition token
var token = function(url) {
    var newToken = {
        url: url,
        id: Math.floor((Math.random() * Number.MAX_SAFE_INTEGER/2-1) + 1),
        timestamp: new Date()
    }
    return newToken;
}

//neues token erstellen
var createToken = function(url) {
    //create token
    var newToken = token(url);
    //globally save new token in array
    tokenArray.push(newToken);
    //return id
    return newToken;
}

//query token by id and url
var getToken = function(id, url) {
    for (var i = 0; i < tokenArray.length; i++) {
        if (id == tokenArray[i].id && url == tokenArray[i].url) {
            //found token
            return tokenArray[i];
            break;
        }
    }
    //found nothing
    return null;
}

/*----------------------HTTP-DISPATCHER------------------------*/

//emaillinks (verifizierung, signout) verarbeiten
var processMailLinks = function(req, res) {
    //url für den httpdispatcher passend zurechtschneiden
    var url = Object.keys(querystring.parse(req.url))[0].slice(0, -1);
    var body = querystring.parse(req.url);

    switch (url) {
        case "/signout":
            console.log(chalk.blue("Signout"));

            userId = body.userid;
            eventId = body.eventid;

            async.waterfall([
                    async.apply(dbQueryEvents, eventId, userId),
                    eventSignoutUser,
                    eventUpdate
                ]),
                function(err, result) {
                    //server reply
                    if (err == null) {
                        //bestätigung senden
                        res.writeHead(200, {
                            'Content-type': 'text/HTML'
                        });
                        res.end();
                    } else {
                        //error senden
                        res.writeHead(404, {
                            'Content-type': 'text/HTML'
                        });
                        res.end(err);
                    }
                }
            break;

        case "/verifySignup":
            //teilnahme des user am event verifizieren
            console.log(chalk.blue("verifySignup"));
            userId = body.userid;
            eventId = body.eventid;
            //event suchen
            //freie plätze überprüfen
            //user in event eintragen oder nicht, email schicken
            async.waterfall([
                async.apply(dbQueryEvents, eventId, userId),
                eventVerifyUser
            ], function(err, result) {
                //server reply
                if (err == null) {
                    //bestätigung senden
                    res.writeHead(200, {
                        'Content-type': 'text/HTML'
                    });
                    res.end();
                } else {
                    //error senden
                    res.writeHead(404, {
                        'Content-type': 'text/HTML'
                    });
                    res.end(err);
                }
            });
            break;

        default:
            console.log(chalk.red("URL nicht erkannt"));
    }
}

var handleRequest = function(req, res) {
    // When dealing with CORS (Cross-Origin Resource Sharing)
    // reqs, the client should pass-through its origin (the
    // reqing domain). We should either echo that or use *
    // if the origin was not passed.
    var origin = (req.headers.origin || "*");

    // Check to see if this is a security check by the browser to
    // test the availability of the API for the client. If the
    // method is OPTIONS, the browser is check to see to see what
    // HTTP methods (and properties) have been granted to the
    // client.
    if (req.method.toUpperCase() === "OPTIONS") {
        console.log("Preflight Cors Request");
        console.log(origin);
        // Echo back the Origin (calling domain) so that the
        // client is granted access to make subsequent reqs
        // to the API.
        res.writeHead(
            "204",
            "No Content", {
                "access-control-allow-origin": origin,
                "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
                "access-control-allow-headers": "content-type, accept, access-control-allow-credentials, accept",
                "Access-Control-Allow-Credentials": "true",
                "access-control-max-age": 10, // Seconds.
                "content-length": 0
            }
        );

        // End the res - we're not sending back any content.
        return (res.end());
    }

    //dispatcher einrichten
    try {
        console.log(req.url);
        console.log(querystring.parse(req.url)) //alle paramter loggen
            //wenn parameter vorhanden, an processMailLinks() weiterleiten
        if (Object.keys(querystring.parse(req.url)).length > 1) {
            console.log(chalk.green("Email-Link erkannt!"));
            processMailLinks(req, res);
        } else {
            dispatcher.dispatch(req, res);
        }
    } catch (err) {
        console.log(err);
    }
    //relativen ressourcenpfad setzen
    dispatcher.setStatic('resources');
    dispatcher.setStaticDirname('.');

    //alle events anfordern
    dispatcher.onGet('/queryEvents', function(req, res) {
        dbQueryEvents(0, 0, function(err, events) {
            if (err == null) {
                //bestätigung senden
                res.writeHead(200, {
                    'Content-type': 'application/JSON ',
                    "access-control-allow-origin": origin
                });
                res.end(JSON.stringify(events));
            } else {
                //error senden
                res.writeHead(404, {
                    'Content-type': 'text/HTML',
                    "access-control-allow-origin": origin
                });
                res.end(err);
            }
        });

    });

    //email-link, welcher den user auf verifiziert setzt
    dispatcher.onPost('/verifySignup', function(req, res) {
        var body = JSON.parse(req.body);

        userId = body.userid;
        eventId = body.eventid;
        //event suchen
        //freie plätze überprüfen
        //user in event eintragen oder nicht, email schicken
        async.waterfall([
            async.apply(dbQueryEvents, eventId, userId),
            eventVerifyUser
        ], function(err, result) {
            //server reply
            if (err == null) {
                //bestätigung senden
                res.writeHead(200, {
                    'Content-type': 'text/HTML',
                    "access-control-allow-origin": origin
                });
                res.end();
            } else {
                //error senden
                res.writeHead(404, {
                    'Content-type': 'text/HTML',
                    "access-control-allow-origin": origin
                });
                res.end(err);
            }
        });
    });

    //user bei event eintragen und in usercollection speichern
    dispatcher.onPost("/signup", function(req, res) {
        var body = JSON.parse(req.body);

        var eventId = body.eventid;

        //definition user
        var user = {
            email: body.email,
            name: body.name,
            verified: false
        }

        //prüfen, ob mailaddresse beriets vorhanden ist
        dbQueryUser(null, user, function(err, queriedUser) {
            //user nicht vorhanden
            if (typeof queriedUser !== "object") {
                async.waterfall([
                    async.apply(dbInsertUser, user, eventId),
                    dbQueryEvents,
                    dbProcessSignup
                ], function(error, result) {
                    //server reply
                    if (error == null) {
                        console.log(chalk.green("User signed up"));
                        //bestätigung senden
                        res.writeHead(200, {
                            'Content-type': 'text/HTML',
                            "access-control-allow-origin": origin
                        });
                        res.end();
                    } else {
                        //error senden
                        res.writeHead(404, {
                            'Content-type': 'text/HTML',
                            "access-control-allow-origin": origin
                        });
                        res.end(error);
                    }
                });
            } else { //user bereits vorhanden
                console.log(chalk.red("User has signed up before"));
                //error senden
                res.writeHead(404, {
                    'Content-type': 'text/HTML',
                    "access-control-allow-origin": origin
                });
                res.end("User bereits vorhanden");
            }
        });
    });

    //login as an admin
    dispatcher.onPost("/adminSignin", function(req, res) {
        console.log(chalk.blue("adminSignin()"));
        var body = JSON.parse(req.body);

        var name = body.name;
        var pw = body.password;
        var url = req.headers.origin;

        if (name == admin && pw == password) { //erfolgreiche anmeldung
            //create token for client
            var token = createToken(url);

            console.dir(token);

            res.writeHead(200, {
                'Set-Cookie': 'id='+token.id,
                'Content-Type': 'text/plain',
                'access-control-allow-credentials': 'true',
                "access-control-allow-origin": origin
            });
            var html = fs.readFileSync("admin.html");
            res.end(html);
        } else { //fehlerhafte anmeldung
            //error senden
            res.writeHead(404, {
                'Content-type': 'text/HTML',
                "access-control-allow-origin": origin
            });
            res.end();
        }
    });

    dispatcher.onPost("/createEvent", function(req, res) {
        var body = JSON.parse(req.body);

        var id = body.id;
        var url = req.headers.origin;

        var token = getToken(id, url);
        console.log(token);

        //definition event
        var newEvent = {
            name: body.name,
            creator: body.creator,
            description: body.description,
            time: body.time,
            maxParticipants: body.maxParticipants,
            participants: [],
        }

        //TODO check admin credentials
        if (token != null) { //adminlogin successful
            console.log(chalk.green("Admin confirmed"));

            dbCreateEvent(newEvent, function(err, doc) {
                //server reply
                if (err == null) {
                    //bestätigung senden
                    res.writeHead(200, {
                        'Content-type': 'text/HTML',
                        "access-control-allow-origin": origin
                    });
                    res.end();
                } else {
                    //error senden
                    res.writeHead(404, {
                        'Content-type': 'text/HTML',
                        "access-control-allow-origin": origin
                    });
                    res.end(err);
                }
            });
        } else { //adminlogin failed
            //error senden
            res.writeHead(404, {
                'Content-type': 'text/HTML',
                "access-control-allow-origin": origin
            });
            res.end("Adminlogin failed");
        }
    });
}

dispatcher.beforeFilter(/\//, function(req, res, chain) { //any url
    //console.log("Before filter");
    chain.next(req, res, chain);
});

dispatcher.afterFilter(/\//, function(req, res, chain) { //any url
    //console.log("After filter");
    chain.next(req, res, chain);
});

dispatcher.onError(function(req, res) {
    res.writeHead(404);
    res.end();
});


//server erstellen
var server = http.createServer(handleRequest);
server.listen(port, host);
console.log('Listening at http://' + host + ':' + port);
