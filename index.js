require('dotenv').config()

const express = require('express');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { start } = require('repl');

const app = express();

// Serve static files (e.g., HTML, CSS, JavaScript)
app.use(express.static(path.join(__dirname, 'public')));

// Google credentials
const credentials = {
    type: process.env.GOOGLE_SERVICE_ACCOUNT_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_X509_CERT_URL,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
    universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
};
console.log(credentials);

// Geocodio api_key
const API_KEY = process.env.GEOCODIO_API_KEY;

// Authenticate with the Google Calendar API
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
});

const calendar = google.calendar({ version: 'v3', auth });

// Array of calendar IDs to fetch events from
const calendarIds = [
    'calendar.lonestarirrigation@gmail.com', // Replace with actual calendar IDs if needed
    'davonzia.lonestarirrigation@gmail.com',
    'matthias.lonestarirrigation@gmail.com',
    'hakeemlonestarirrigation@gmail.com'
    // Add more calendar IDs as needed
];

// Function to geocode using Geocodio
async function geocodeWithGeocodio(address) {
    try {
        const response = await axios.get('https://api.geocod.io/v1.6/geocode', {
            params: {
                api_key: API_KEY,
                q: address
            }
        });

        if (response.data.results.length > 0) {
            return response.data.results[0].location;
        } else {
            console.error('Geocodio: No results found for address:', address);
            return null;
        }
    } catch (error) {
        console.error('Error during Geocodio geocoding:', error.response ? error.response.data : error.message);
        return null;
    }
}

// Function to geocode using Nominatim
async function geocodeWithNominatim(address) {
    try {
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                q: address,
                format: 'json',
                addressdetails: 1,
                limit: 1
            }
        });

        if (response.data.length > 0) {
            const location = response.data[0];
            return {
                lat: location.lat,
                lng: location.lon
            };
        } else {
            console.error('Nominatim: No results found for address:', address);
            return null;
        }
    } catch (error) {
        console.error('Error during Nominatim geocoding:', error.message);
        return null;
    }
}

// Combined geocode function with fallback to Nominatim
async function geocodeLocation(address) {
    if (!address) {
        console.error('Empty address provided, skipping geocoding.');
        return null;
    }

    let location = await geocodeWithGeocodio(address);

    if (!location) {
        console.log('Falling back to Nominatim for address:', address);
        location = await geocodeWithNominatim(address);
    }

    return location;
}

app.get('/api/events', async (req, res) => {
    try {
        const { timeMin, timeMax } = req.query;

        if (!timeMin || !timeMax) {
            return res.status(400).send('Both timeMin and timeMax query parameters are required');
        }

        const events = [];

        for (const calendarId of calendarIds) {
            let pageToken = null;
            do {
                try {
                    const response = await calendar.events.list({
                        calendarId: calendarId,
                        timeMin: new Date(timeMin).toISOString(),
                        timeMax: new Date(timeMax).toISOString(),
                        singleEvents: true,
                        orderBy: 'startTime',
                        pageToken: pageToken,
                    });

                    for (const item of response.data.items) {
                        console.log('Geocoding address:', item.location);  // Log the address being geocoded
                        const location = await geocodeLocation(item.location);

                        // Only push the event if geocoding returns valid coordinates
                        if (location) {
                            events.push({
                                title: item.summary || 'No Title',
                                start: item.start.dateTime || item.start.date,
                                end: item.end.dateTime || item.end.date,
                                location: item.location,
                                coordinates: location,  // Valid coordinates only
                                technician: calendarId,  // Assign technician by calendarId
                                client: item.attendees ? item.attendees[0].email : 'No Client'
                            });
                        } else {
                            console.log(`Skipping event "${item.summary}" due to failed geocoding.`);
                        }
                    }

                    pageToken = response.data.nextPageToken;
                } catch (error) {
                    console.error(`Error fetching events for calendar ID: ${calendarId}`);
                    console.error(error.response ? error.response.data : error.message);
                }
            } while (pageToken);
        }

        res.json(events);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));