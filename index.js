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
    secret: 'your super secret key', // Replace with a random secret
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
}, (identifier, profile, done) => {
    profile.identifier = identifier;
    return done(null, profile);
}));

// --- ROUTES ---

app.get('/', (req, res) => {
    res.send('Steam Game Finder Backend is running!');
});

app.get('/auth/steam', passport.authenticate('steam'));

app.get('/auth/steam/return',
    passport.authenticate('steam', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect(`${FRONTEND_URL}?steamid=${req.user.id}`);
    }
);

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
        const friendListResponse = await axios.get(`http://api.steampowered.com/ISteamUser/GetFriendList/v0001/?key=${STEAM_API_KEY}&steamid=${steamid}&relationship=friend`);
        if (!friendListResponse.data.friendslist) {
            return res.json({ friendslist: { friends: [] } });
        }
        const friendIds = friendListResponse.data.friendslist.friends.map(f => f.steamid).join(',');
        const friendSummariesResponse = await axios.get(`http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${friendIds}`);
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

// --- UPDATED ENDPOINT FOR PARTIAL MATCHES ---
app.get('/api/shared-games', async (req, res) => {
    const { steamids } = req.query;
    if (!steamids) return res.status(400).json({ error: 'SteamIDs are required' });

    const ids = steamids.split(',');
    const totalPlayers = ids.length;
    const ownershipThreshold = 0.8; // 80%

    try {
        const allGamesPromises = ids.map(id =>
            axios.get(`http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${STEAM_API_KEY}&steamid=${id}&format=json`)
        );
        const responses = await Promise.all(allGamesPromises);

        const gameOwnershipMap = new Map();
        responses.forEach((response, index) => {
            if (response.data.response.games) {
                const steamID = ids[index];
                response.data.response.games.forEach(game => {
                    if (!gameOwnershipMap.has(game.appid)) {
                        gameOwnershipMap.set(game.appid, []);
                    }
                    gameOwnershipMap.get(game.appid).push(steamID);
                });
            }
        });

        const partiallyMatchedGames = [];
        for (const [appid, owners] of gameOwnershipMap.entries()) {
            const ownershipRatio = owners.length / totalPlayers;
            if (ownershipRatio >= ownershipThreshold) {
                partiallyMatchedGames.push({ appid, owners });
            }
        }

        // Sort by most owners first, then by appid
        partiallyMatchedGames.sort((a, b) => b.owners.length - a.owners.length || a.appid - b.appid);

        const gameDetailsPromises = partiallyMatchedGames.slice(0, 30).map(async (game) => {
            try {
                const detailsRes = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${game.appid}`);
                const details = detailsRes.data[game.appid];

                if (details && details.success) {
                    const playersRes = await axios.get(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${game.appid}`);
                    const nonOwners = ids.filter(id => !game.owners.includes(id));

                    return {
                        ...details.data,
                        player_count: playersRes.data.response.player_count || 0,
                        owners: game.owners,
                        nonOwners: nonOwners
                    };
                }
                return null;
            } catch (e) {
                return null; // Ignore games that fail to fetch
            }
        });

        const finalGames = (await Promise.all(gameDetailsPromises)).filter(Boolean); // Filter out nulls

        res.json({ games: finalGames });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch shared games' });
    }
});


app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
