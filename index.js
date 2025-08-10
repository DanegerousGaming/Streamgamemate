<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Streams Friend Game Finder</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Inter', sans-serif;
        }
        .chart-container {
            position: relative;
            width: 100%;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
            height: 250px;
            max-height: 300px;
        }
        @media (min-width: 768px) {
            .chart-container {
                height: 350px;
            }
        }
        .loader {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #3498db;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .avatar-list img {
            border: 2px solid white;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
    </style>
</head>
<body class="bg-gray-100 text-gray-800">

    <div id="login-screen" class="flex items-center justify-center h-screen">
        <div class="text-center p-8 bg-white rounded-lg shadow-xl">
            <h1 class="text-4xl font-bold text-gray-900 mb-4">Streams Friend Game Finder</h1>
            <p class="text-gray-600 mb-8">Find the games you and your friends can play together.</p>
            <button id="login-button" class="bg-blue-600 text-white font-bold py-3 px-6 rounded-lg hover:bg-blue-700 transition duration-300">
                Sign in with Steam
            </button>
        </div>
    </div>

    <div id="app-dashboard" class="hidden">
        <header class="bg-white shadow-md p-4 flex justify-between items-center">
            <h1 class="text-2xl font-bold">Game Finder Dashboard</h1>
            <div id="user-profile" class="flex items-center">
            </div>
        </header>

        <main class="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-4 gap-8">
            
            <aside class="lg:col-span-1 bg-white p-6 rounded-lg shadow-lg">
                <h2 class="text-xl font-bold mb-4 border-b pb-2">Friends List</h2>
                <div id="friends-list" class="space-y-3 h-96 overflow-y-auto">
                    <div class="loader"></div>
                </div>
            </aside>

            <section class="lg:col-span-2 bg-white p-6 rounded-lg shadow-lg">
                <h2 class="text-xl font-bold mb-4 border-b pb-2">Matching Games (80%+)</h2>
                <p class="mb-4 text-gray-600">Select friends to see games that most of you own. The list will update automatically.</p>
                <div id="shared-games-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6 h-[40rem] overflow-y-auto p-2">
                     <p class="text-gray-500 col-span-full text-center mt-10">Please select some friends to see shared games.</p>
                </div>
            </section>

            <aside class="lg:col-span-1 bg-white p-6 rounded-lg shadow-lg">
                <h2 class="text-xl font-bold mb-4 border-b pb-2">Group Management</h2>
                <div class="mb-6">
                    <h3 class="font-semibold mb-2">Selected Friends:</h3>
                    <div id="selected-friends-list" class="flex flex-wrap gap-2">
                        <p class="text-gray-500">None selected.</p>
                    </div>
                </div>
                <div class="mb-6">
                    <label for="group-name" class="block font-semibold mb-2">Group Name:</label>
                    <input type="text" id="group-name" class="w-full p-2 border rounded-md" placeholder="e.g., Weekend Warriors">
                    <button id="save-group-button" class="w-full mt-2 bg-green-600 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-700 transition">Save Group</button>
                </div>
                
                <h2 class="text-xl font-bold mb-4 border-b pb-2">Player Counts</h2>
                 <div class="chart-container">
                    <canvas id="player-chart"></canvas>
                </div>
            </aside>

        </main>
    </div>

    <script>
        const BACKEND_URL = 'https://streamgamemate.vercel.app'; 

        const loginScreen = document.getElementById('login-screen');
        const appDashboard = document.getElementById('app-dashboard');
        const loginButton = document.getElementById('login-button');
        const userProfileContainer = document.getElementById('user-profile');
        const friendsListContainer = document.getElementById('friends-list');
        const sharedGamesGrid = document.getElementById('shared-games-grid');
        const selectedFriendsList = document.getElementById('selected-friends-list');
        
        let user = null;
        let friends = [];
        let allGroupMembers = [];
        let selectedFriendIds = new Set();
        let playerChart;

        async function apiFetch(endpoint) {
            try {
                const response = await fetch(`${BACKEND_URL}${endpoint}`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return await response.json();
            } catch (error) {
                console.error("API fetch error:", error);
                alert("Failed to fetch data from the server. Please check the console for details.");
                return null;
            }
        }

        function renderUserProfile() {
            userProfileContainer.innerHTML = `
                <span class="mr-4 font-medium">Welcome, ${user.personaname}!</span>
                <img src="${user.avatar}" class="w-10 h-10 rounded-full mr-4" alt="User Avatar">
                <button id="logout-button" class="bg-red-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-red-600 transition">Logout</button>
            `;
            document.getElementById('logout-button').addEventListener('click', () => {
                window.location.href = window.location.pathname;
            });
        }

        async function renderFriends() {
            friendsListContainer.innerHTML = '<div class="loader"></div>';
            const data = await apiFetch(`/api/friends?steamid=${user.steamid}`);
            if (data && data.friendslist && data.friendslist.friends) {
                friends = data.friendslist.friends;
                allGroupMembers = [user, ...friends];
                friendsListContainer.innerHTML = '';
                friends.forEach(friend => {
                    const friendDiv = document.createElement('div');
                    friendDiv.className = 'p-3 rounded-lg cursor-pointer transition flex items-center justify-between bg-gray-200';
                    friendDiv.innerHTML = `<span>${friend.personaname}</span><img src="${friend.avatar}" class="w-8 h-8 rounded-full">`;
                    friendDiv.dataset.friendId = friend.steamid;
                    friendDiv.onclick = () => toggleFriendSelection(friend.steamid, friendDiv);
                    friendsListContainer.appendChild(friendDiv);
                });
            } else {
                friendsListContainer.innerHTML = '<p class="text-gray-500">Could not load friends list. Your profile might be private.</p>';
            }
        }

        function toggleFriendSelection(friendId, element) {
            if (selectedFriendIds.has(friendId)) {
                selectedFriendIds.delete(friendId);
                element.classList.remove('bg-blue-500', 'text-white');
                element.classList.add('bg-gray-200');
            } else {
                selectedFriendIds.add(friendId);
                element.classList.add('bg-blue-500', 'text-white');
                element.classList.remove('bg-gray-200');
            }
            updateSharedGames();
            updateSelectedFriendsList();
        }
        
        function updateSelectedFriendsList() {
            selectedFriendsList.innerHTML = '';
            if (selectedFriendIds.size === 0) {
                selectedFriendsList.innerHTML = '<p class="text-gray-500">None selected.</p>';
                return;
            }
            selectedFriendIds.forEach(id => {
                const friend = friends.find(f => f.steamid === id);
                if (friend) {
                    const friendTag = document.createElement('span');
                    friendTag.className = 'bg-blue-200 text-blue-800 text-sm font-semibold mr-2 px-2.5 py-0.5 rounded';
                    friendTag.textContent = friend.personaname;
                    selectedFriendsList.appendChild(friendTag);
                }
            });
        }

        async function updateSharedGames() {
            if (selectedFriendIds.size === 0) {
                sharedGamesGrid.innerHTML = '<p class="text-gray-500 col-span-full text-center mt-10">Please select some friends to see shared games.</p>';
                updatePlayerChart([]);
                return;
            }

            sharedGamesGrid.innerHTML = '<div class="loader col-span-full"></div>';
            const allIds = [user.steamid, ...selectedFriendIds];
            const data = await apiFetch(`/api/shared-games?steamids=${allIds.join(',')}`);

            if (data && data.games && data.games.length > 0) {
                sharedGamesGrid.innerHTML = '';
                data.games.forEach(game => {
                    const gameCard = document.createElement('div');
                    gameCard.className = 'bg-gray-50 rounded-lg shadow-md overflow-hidden flex flex-col';
                    
                    let priceHTML = `<p class="text-lg font-semibold text-green-600">${game.price_overview ? game.price_overview.final_formatted : 'Free to Play'}</p>`;
                    if (game.price_overview && game.price_overview.discount_percent > 0) {
                        priceHTML = `<p class="text-lg font-bold text-red-500">${game.price_overview.final_formatted} <span class="text-sm text-gray-500 line-through ml-2">${game.price_overview.initial_formatted}</span></p>`;
                    } else if (!game.price_overview && !game.is_free) {
                        priceHTML = `<p class="text-lg font-semibold text-gray-700">N/A</p>`;
                    }
                    
                    const ownershipPercentage = (game.owners.length / allIds.length) * 100;

                    const getAvatar = (id) => allGroupMembers.find(m => m.steamid === id)?.avatar || '';

                    const ownersHTML = game.owners.map(id => `<img src="${getAvatar(id)}" class="w-8 h-8 rounded-full -ml-2" title="${allGroupMembers.find(m => m.steamid === id)?.personaname || ''}">`).join('');
                    const nonOwnersHTML = game.nonOwners.map(id => `<img src="${getAvatar(id)}" class="w-8 h-8 rounded-full -ml-2 opacity-40" title="${allGroupMembers.find(m => m.steamid === id)?.personaname || ''}">`).join('');

                    gameCard.innerHTML = `
                        <div class="relative">
                            <img src="${game.header_image}" alt="${game.name}" class="w-full h-32 object-cover">
                            <div class="absolute bottom-2 right-2 bg-black bg-opacity-60 text-white text-xs font-bold px-2 py-1 rounded">
                                ${(game.player_count || 0).toLocaleString()} players
                            </div>
                        </div>
                        <div class="p-4 flex-grow flex flex-col">
                            <h3 class="text-lg font-bold">${game.name}</h3>
                            <div class="mt-2 mb-3">
                                <div class="flex justify-between items-center text-sm font-semibold text-gray-600 mb-1">
                                    <span>Ownership</span>
                                    <span>${game.owners.length} / ${allIds.length}</span>
                                </div>
                                <div class="w-full bg-gray-200 rounded-full h-2.5">
                                    <div class="bg-blue-600 h-2.5 rounded-full" style="width: ${ownershipPercentage}%"></div>
                                </div>
                            </div>
                             <div class="flex items-center mt-2 avatar-list">
                                <span class="text-green-600 font-bold mr-2 text-xs">HAVE:</span>
                                ${ownersHTML}
                            </div>
                            <div class="flex items-center mt-2 avatar-list">
                                <span class="text-red-600 font-bold mr-2 text-xs">NEED:</span>
                                ${nonOwnersHTML}
                            </div>
                            <div class="mt-auto pt-4 text-right">
                                ${priceHTML}
                            </div>
                        </div>
                    `;
                    sharedGamesGrid.appendChild(gameCard);
                });
                updatePlayerChart(data.games);
            } else {
                 sharedGamesGrid.innerHTML = `<p class="text-gray-500 col-span-full text-center mt-10">No games found with at least 80% ownership.</p>`;
                 updatePlayerChart([]);
            }
        }
        
        function updatePlayerChart(games) {
            const ctx = document.getElementById('player-chart').getContext('2d');
            const chartData = {
                labels: games.map(g => g.name.length > 16 ? g.name.substring(0, 13) + '...' : g.name),
                datasets: [{
                    label: 'Current Players',
                    data: games.map(g => g.player_count || 0),
                    backgroundColor: 'rgba(59, 130, 246, 0.5)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1
                }]
            };

            if (playerChart) playerChart.destroy();
            
            playerChart = new Chart(ctx, {
                type: 'bar',
                data: chartData,
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { x: { beginAtZero: true } }
                }
            });
        }

        loginButton.addEventListener('click', () => {
            window.location.href = `${BACKEND_URL}/auth/steam`;
        });

        window.onload = async () => {
            const urlParams = new URLSearchParams(window.location.search);
            const steamid = urlParams.get('steamid');

            if (steamid) {
                const data = await apiFetch(`/api/user?steamid=${steamid}`);
                if (data && data.response && data.response.players.length > 0) {
                    user = data.response.players[0];
                    loginScreen.classList.add('hidden');
                    appDashboard.classList.remove('hidden');
                    renderUserProfile();
                    renderFriends();
                    updatePlayerChart([]);
                } else {
                    alert('Could not verify user. Please try logging in again.');
                }
            }
        };

    </script>
</body>
</html>
