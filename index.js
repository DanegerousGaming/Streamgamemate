const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// --- IMPORTANT CONFIGURATION ---
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const VERCEL_URL = process.env.VERCEL_URL; // Your Vercel deployment URL
const FRONTEND_URL = process.env.FRONTEND_URL; // The URL of your frontend app


// --- CORS Configuration ---
app.use(cors({
    origin: function (origin, callback) {
        const allowedOrigins = [
            'https://danegerousgaming.github.io', 
            'http://localhost:3000'
        ];

        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(session({
    secret: 'your secret key', // Replace with a random secret
    resave: false,
    saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

passport.use(new SteamStrategy({
    returnURL: 'https://' + process.env.VERCEL_URL + '/auth/steam/return',
    realm: 'https://' + process.env.VERCEL_URL,
    apiKey: process.env.STEAM_API_KEY
}, (identifier, profile, done) => { // The callback function is now correctly placed inside
    profile.identifier = identifier;
    return done(null, profile);
}));

// --- AUTHENTICATION ROUTES ---
app.get('/auth/steam', passport.authenticate('steam'));

app.get('/auth/steam/return',
    passport.authenticate('steam', { failureRedirect: '/' }),
    (req, res) => {
        // Successful authentication, redirect to frontend with steamid
        res.redirect(`${FRONTEND_URL}?steamid=${req.user.id}`);
    }
);
// --- ROOT WELCOME ROUTE ---
app.get('/', (req, res) => {
    res.send('Steam Game Finder Backend is running!');
});
// --- API PROXY ROUTES ---
app.get('/api/user', async (req, res) => {
    const { steamid } = req.query;
    if (!steamid) return res.status(400).json({ error: 'SteamID is required' });
    try {
        const response = await axios.get(`http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamid}`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch user data' });
    }
});

app.get('/api/friends', async (req, res) => {
    const { steamid } = req.query;
    if (!steamid) return res.status(400).json({ error: 'SteamID is required' });
    try {
        // First, get the friend IDs
        const friendListResponse = await axios.get(`http://api.steampowered.com/ISteamUser/GetFriendList/v0001/?key=${STEAM_API_KEY}&steamid=${steamid}&relationship=friend`);
        const friendIds = friendListResponse.data.friendslist.friends.map(f => f.steamid).join(',');

        // Then, get the profile info for all friends
        const friendSummariesResponse = await axios.get(`http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${friendIds}`);
        
        // Combine the data into a more useful format
        const friendsWithDetails = friendSummariesResponse.data.response.players.map(player => ({
            steamid: player.steamid,
            personaname: player.personaname,
            avatar: player.avatarfull
        }));

        res.json({ friendslist: { friends: friendsWithDetails } });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch friends list' });
    }
});


app.get('/api/shared-games', async (req, res) => {
    const { steamids } = req.query;
    if (!steamids) return res.status(400).json({ error: 'SteamIDs are required' });

    const ids = steamids.split(',');
    try {
        const allGamesPromises = ids.map(id => 
            axios.get(`http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${STEAM_API_KEY}&steamid=${id}&format=json`)
        );
        const responses = await Promise.all(allGamesPromises);
        const userGames = responses.map(r => new Set(r.data.response.games.map(g => g.appid)));

        const sharedGameIds = [...userGames[0]].filter(gameId => userGames.every(gamesSet => gamesSet.has(gameId)));
        
        // For simplicity, we'll just return the IDs. A full implementation would fetch game details.
        const gameDetailsPromises = sharedGameIds.slice(0, 20).map(appid => // Limit to 20 to avoid long load times
             axios.get(`https://store.steampowered.com/api/appdetails?appids=${appid}`)
        );
        const gameDetailsResponses = await Promise.all(gameDetailsPromises);

        const gamesWithDetails = gameDetailsResponses
            .map(response => response.data[Object.keys(response.data)[0]].data)
            .filter(game => game) // Filter out any failed fetches
            .map(async (game) => {
                const playersResponse = await axios.get(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${game.steam_appid}`);
                game.player_count = playersResponse.data.response.player_count;
                return game;
            });
            
        const finalGames = await Promise.all(gamesWithDetails);

        res.json({ games: finalGames });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch shared games' });
    }
});


app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});





