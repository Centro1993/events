const http = require('http');
const dispatcher = require('httpdispatcher');
const async = require('async');
const Datastore = require('nedb');
const chalk = require('chalk');
const nodemailer = require('nodemailer');

//db laden
db = {};
db.users = new Datastore('db/users.db');
db.events = new Datastore('db/events.db');

db.users.loadDatabase();
db.events.loadDatabase();

//servervariablen
const host = '0.0.0.0';
const port = 3002;

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
    timestamp: new Date()
  }

  console.dir(participant);

  //user in event eintragen als unbestätigt eintragen
  event.participants.push(participant);
  //nach freien plätzen prüfen
  if (eventCheckPlaces(event) > 0) {
    //email mit bestätigungsanfrage schicken
    sendMail(user['_id'], event['_id'], 1);
  } else {
    //wartelistenmail schicken
    sendMail(user['_id'], event['_id'], 3);
  }
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
      sendMail(event['_id'], userId, 1);
    } else { //wartelistenmail schicken
      sendMail(event['_id'], userId, 3);
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
    5. entsprechen der anzahl an freigewordener plätze einladungsmails verschicken
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
  //für alle freigewordenden plätze
  for (var i = 0; i < freePlacesDifference; i++) {
    //alle user im event durchlaufen
    for (var h = 0; h < event.length; h++) {

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
      var verifyLink ="<a>www.chaostreff-flensburg.de";
        //bestätigung eventteilnahme
        var mailOptions = {
          from: '"Chaostreff Flensburg" <events@chaostreff-flensburg.de>', // sender address
          to: user.email, // list of receivers
          subject: 'Teilnahme an '+event.name, // Subject line
          text: 'Hallo '+user.name+'!', // plaintext body
          html: '<b>Hallo '+user.name+'! Um deine Teilnahme am Event '+event.name+' zu bestätigen, klicke auf diesen Link: '+verifyLink'</b>' // html body
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
  });
}

/*----------------------HTTP-DISPATCHER------------------------*/
var handleRequest = function(req, res) {
  //dispatcher einrichten
  try {
    console.log(req.url);
    dispatcher.dispatch(req, res);
  } catch (err) {
    console.log(err);
  }
  //relativen ressourcenpfad setzen
  dispatcher.setStatic('resources');
  dispatcher.setStaticDirname('/');

  //alle events anfordern
  dispatcher.onGet('/queryEvents', function(req, res) {
    dbQueryEvents(0, 0, function(err, events) {
      if (err == null) {
        //bestätigung senden
        res.writeHead(200, {
          'Content-type': 'text/HTML'
        });
        res.end(JSON.stringify(events));
      } else {
        //error senden
        res.writeHead(404, {
          'Content-type': 'text/HTML'
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
  });

  //TODO email-link, welcher einen user aus der veranstaltung austrägt
  dispatcher.onPost('/signout', function(req, res) {
    var body = JSON.parse(req.body);

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
      if(typeof queriedUser !== "object") {
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
              'Content-type': 'text/HTML'
            });
            res.end();
          } else {
            //error senden
            res.writeHead(404, {
              'Content-type': 'text/HTML'
            });
            res.end(error);
          }
        });
      } else {    //user bereits vorhanden
        console.log(chalk.red("User has signed up before"));
        //error senden
        res.writeHead(404, {
          'Content-type': 'text/HTML'
        });
        res.end("User bereits vorhanden");
      }
    });
  });

  dispatcher.onPost("/createEvent", function(req, res) {
    var body = JSON.parse(req.body);

    //definition event
    var newEvent = {
      name: body.name,
      creator: body.creator,
      description: body.description,
      time: body.time,
      maxParticipants: body.maxParticipants,
      participants: [],
    }

    dbCreateEvent(newEvent, function(err, doc) {
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
  });
}


//server erstellen
var server = http.createServer(handleRequest);
server.listen(port, host);
console.log('Listening at http://' + host + ':' + port);
