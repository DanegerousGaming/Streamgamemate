const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// --- CONFIGURATION ---
const STEAM_API_KEY = process.env.STEAM_API_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL;
const SESSION_SECRET = process.env.SESSION_SECRET || 'a default secret for local development';

// --- MIDDLEWARE SETUP ---

app.use(cors({
    origin: function (origin, callback) {
        const allowedOrigins = [FRONTEND_URL, 'https://danegerousgaming.github.io', 'http://localhost:3000'];
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`CORS blocked for origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 // 24 hours
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// --- PASSPORT STEAM STRATEGY ---

passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

// --- CORE FIX: Determine the correct base URL for production and local environments ---
const isProduction = !!process.env.VERCEL_URL;
// Vercel provides the domain without the protocol. We must add it.
const baseUrl = isProduction ? `https://${process.env.VERCEL_URL}` : `http://localhost:${PORT}`;

passport.use(new SteamStrategy({
    // Use the correctly constructed baseUrl
    returnURL: `${baseUrl}/auth/steam/return`,
    realm: baseUrl,
    apiKey: STEAM_API_KEY
}, (identifier, profile, done) => {
    return done(null, profile);
}));


// --- AUTHENTICATION ROUTES ---

app.get('/auth/steam', passport.authenticate('steam'));

app.get('/auth/steam/return',
    passport.authenticate('steam', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect(`${FRONTEND_URL}?steamid=${req.user.id}`);
    }
);

// --- API ROUTES ---

app.get('/api/user', async (req, res) => {
    const { steamid } = req.query;
    if (!steamid) {
        return res.status(400).json({ message: 'SteamID is required' });
    }
    try {
        const url = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${steamid}`;
        const response = await axios.get(url);
        res.json(response.data);
    } catch (error) {
        console.error(`Error fetching user data for steamid ${steamid}:`, error.message);
        res.status(500).json({ message: 'Failed to fetch user data from Steam' });
    }
});

app.get('/api/friends', async (req, res) => {
    const { steamid } = req.query;
    if (!steamid) {
        return res.status(400).json({ message: 'SteamID is required' });
    }
    try {
        const friendsListUrl = `http://api.steampowered.com/ISteamUser/GetFriendList/v0001/?key=${STEAM_API_KEY}&steamid=${steamid}&relationship=friend`;
        const friendListResponse = await axios.get(friendsListUrl);

        if (!friendListResponse.data.friendslist || friendListResponse.data.friendslist.friends.length === 0) {
            return res.json({ friendslist: { friends: [] } });
        }

        const friendIds = friendListResponse.data.friendslist.friends.map(f => f.steamid).join(',');
        const summariesUrl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${friendIds}`;
        const friendSummariesResponse = await axios.get(summariesUrl);

        const friendsWithDetails = friendSummariesResponse.data.response.players.map(player => ({
            steamid: player.steamid,
            personaname: player.personaname,
            avatar: player.avatarfull
        }));

        res.json({ friendslist: { friends: friendsWithDetails } });
    } catch (error) {
        console.error(`Error fetching friends for steamid ${steamid} (profile may be private):`, error.message);
        res.status(500).json({ message: 'Could not retrieve friends list. The user\'s profile may be private.' });
    }
});

// A helper function to introduce a delay.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

app.get('/api/shared-games', async (req, res) => {
    const { steamids, cc = 'us', threshold = '0.8' } = req.query;
    if (!steamids) {
        return res.status(400).json({ message: 'A list of SteamIDs is required' });
    }

    const ids = steamids.split(',');
    const ownershipThreshold = parseFloat(threshold);

    try {
        const gameOwnershipMap = new Map();
        let publicProfilesCount = 0;

        // --- CORE FIX: Process requests sequentially with a delay to avoid rate limiting ---
        for (const id of ids) {
            try {
                const url = `http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${STEAM_API_KEY}&steamid=${id}&format=json&include_played_free_games=1&include_appinfo=1`;
                const response = await axios.get(url);

                if (response.data.response && response.data.response.games) {
                    publicProfilesCount++;
                    response.data.response.games.forEach(game => {
                        if (!gameOwnershipMap.has(game.appid)) {
                            gameOwnershipMap.set(game.appid, { owners: [], playtimes: {} });
                        }
                        const entry = gameOwnershipMap.get(game.appid);
                        entry.owners.push(id);
                        entry.playtimes[id] = game.playtime_forever;
                    });
                }
            } catch (error) {
                 console.warn(`Could not fetch games for SteamID: ${id}. Profile is likely private or API failed.`);
            }
            // Add a small delay between each request to be respectful to the Steam API
            await delay(200); // 200ms delay
        }


        if (publicProfilesCount === 0) {
            return res.json({ games: [], publicProfilesScanned: 0, totalProfilesRequested: ids.length });
        }

        const matchedGames = [];
        for (const [appid, data] of gameOwnershipMap.entries()) {
            const ownershipRatio = data.owners.length / publicProfilesCount;
            if (ownershipRatio >= ownershipThreshold) {
                matchedGames.push({ appid, ...data });
            }
        }

        matchedGames.sort((a, b) => b.owners.length - a.owners.length);

        const detailedGamePromises = matchedGames.slice(0, 100).map(async (game) => {
            try {
                const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${game.appid}&cc=${cc}`;
                const detailsRes = await axios.get(detailsUrl);
                const details = detailsRes.data[game.appid];

                if (details && details.success) {
                    const playersUrl = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${game.appid}`;
                    const playersRes = await axios.get(playersUrl);
                    
                    return {
                        ...details.data,
                        player_count: playersRes.data.response.player_count || 0,
                        owners: game.owners,
                        nonOwners: ids.filter(id => !game.owners.includes(id)),
                        playtimes: game.playtimes
                    };
                }
                return null;
            } catch (error) {
                console.error(`Could not fetch details for appid ${game.appid}: ${error.message}`);
                return null;
            }
        });

        const finalGames = (await Promise.all(detailedGamePromises)).filter(Boolean);

        res.json({
            games: finalGames,
            publicProfilesScanned: publicProfilesCount,
            totalProfilesRequested: ids.length
        });

    } catch (error) {
        console.error('Critical error in /api/shared-games:', error.message);
        res.status(500).json({ message: 'An unexpected server error occurred.' });
    }
});


// --- SERVER INITIALIZATION ---
app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
