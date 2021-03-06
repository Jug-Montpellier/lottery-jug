const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const rp = require('request-promise');

const token = process.env.EVENTBRITE_TOKEN;
const organizer = process.env.ORGANIZER_TOKEN;

const cache = {
  eventId: null,
  attendees: []
}

console.log(`Starting lottery for ${organizer} with token ${token}`);

const range = (start, end) => {
  let pages = []
  for (var i = start ; i < end; i++) {
     pages.push(i);
  }
  return pages
}

const get = (path) => fetch(path).then(payload => payload.json())

const getRandomIds = (max, numbers) => {
  if (numbers >= max) {
    return range(0, max)
  }
  console.log(`Generating ${numbers} random numbers for ${max}`)
  return range(0, numbers).reduce((acc, _) => {
      let index
      do {
        index =  Math.floor(Math.random() * max)
      } while (acc.includes(index));
      acc.push(index)
      return acc
    }, [])
}

const getAttendees = (event_id) => {
    return get(`https://www.eventbriteapi.com/v3/events/${event_id}/attendees/?token=${token}`)
      .then(attendees =>
      Promise.all(
        range(attendees.pagination.page_number +1, attendees.pagination.page_count)
          .reduce((acc, val) => acc.concat([get(`https://www.eventbriteapi.com/v3/events/${event_id}/attendees?token=${token}&page=${val}`).then(data => data.attendees)]), attendees.attendees))
        .then(values => [].concat.apply([], values))
    )
}

const errorRequest = (res, status, error) => {
  console.error(error)
  res.status(status);
  res.json(error);
}

const fetchCache = () => {
  get(`https://www.eventbriteapi.com/v3/events/search/?sort_by=date&organizer.id=${organizer}&token=${token}`)
    .then(data => {
      if (data.events.length < 1) {
        return Promise.reject(new Error("No event available"))
      }
      cache.eventId = data.events[0].id
      return cache.eventId
    })
    .then(event_id => getAttendees(event_id))
    .then(attendees => cache.attendees = attendees)
    .catch(error => cache.eventId = null)
    .then(_ => setTimeout(fetchCache, 3600000));
}

const app = express();

app.use(cors());

app.get('/winners', function(req, res){
  const nb_winner = req.query.nb
  if (nb_winner == undefined || isNaN(nb_winner) || nb_winner < 0) {
    res.status(400)
    res.json({error: 'Nb param should be a positive integer'})
  } else if (nb_winner == 0) {
    res.json([])
  } else {
    console.log(`Generating ${nb_winner} winners`)
    new Promise((success, reject) => {
      if (cache.eventId == null) {
        reject(new Error("No event available"))
      } else {
        success(cache.attendees)
      }
    }).then(attendees => getRandomIds(attendees.length, nb_winner).map((index) => attendees[index]))
      .then(winners => {console.log("Found winners"); return winners})
      .then(winners => winners.map(({profile: {first_name: first_name, last_name: last_name}}) => { return {first_name: first_name, last_name: last_name}}))
      .then(winners => res.json(winners))
      .catch(error => errorRequest(res, 500, error))
  }
});

console.log("Start cache warmup")
fetchCache()

console.log("Start web server")
app.listen(3000);
