# Ether —  Dashboard for Node-RED with  real-time monitoring and live status



## Dashboard Features

**Authentication**

* Dashboard connects Node-RED with Google OAuth, Facebook OAuth, and local authentication
* NodeRed url can be configured from Dashboard to get live feed


**Flow Canvas**

* Live SVG flow visualization with animated connectors
* Per-node status: idle / running / done / warn / error
* Execution time overlays and sparkline history
* Per-node timing bars

**Debug Logs**

* Filterable by level (DEBUG / INFO / WARN / ERROR)
* Full-text search
* Payload inspector on click
* WebSocket live feed from Node-RED

**Config Tab**

* Node-RED URL configuration
* Auth provider status overview
* Setup guide for Google \& Facebook





![](https://raw.githubusercontent.com/tech-inducers/ether/main/images/login.png)
![](https://raw.githubusercontent.com/tech-inducers/ether/main/images/dash_board.png)

## Project Structure

```
ether/
├── public/index.html
├── src/    
│   ├──components/DebugBiwer.jsx  ← Debug view and save
│   ├── context/AuthContext.jsx   ← All auth logic (Google, Facebook, local)
│   ├── hooks/useNodeRed.js       ← Node-RED WebSocket + flow data
│   ├── pages/
│   │   ├── LoginPage.jsx         ← Auth UI (all 3 providers)
│   │   └── DashboardPage.jsx     ← Flow monitor + debug logs
│   ├── App.jsx                   ← Router + protected routes
│   └── index.js
├── node-red-auth-flows.json      ← Import this into Node-RED
└── package.json


## Quick Start

### 1 Install \& run the Ether

```bash
cd ControlPlane
npm install
npm start
# Opens at http://localhost:3000
```

### 2\. Import flows into Node-RED

1. Open Node-RED → Menu → Import
2. Paste contents of `node-red-auth-flows.json`
3. Click Import → Deploy

### 3\. Local auth works immediately

* Go to http://localhost:3000
* Enter any email + password (min 6 chars)
* Dashboard opens in demo mode if Node-RED isn't running

\---

## Google OAuth Setup

1. Go to https://console.cloud.google.com
2. Create a project → APIs \& Services → Credentials
3. Create OAuth 2.0 Client ID (Web application)
4. Add authorized redirect URI: `http://localhost:1880/auth/google/callback`
5. Copy Client ID and Client Secret
6. In Node-RED settings.js, add:

```js
process.env.GOOGLE\_CLIENT\_ID     = 'your-client-id';
process.env.GOOGLE\_CLIENT\_SECRET = 'your-client-secret';
```

Or set via Node-RED environment variables in the function node.

\---

## Facebook OAuth Setup

1. Go to https://developers.facebook.com
2. Create App → Consumer → Add Facebook Login product
3. Settings → Valid OAuth Redirect URIs: `http://localhost:1880/auth/facebook/callback`
4. Copy App ID and App Secret
5. In Node-RED, set:

```js
process.env.FACEBOOK\_APP\_ID     = 'your-app-id';
process.env.FACEBOOK\_APP\_SECRET = 'your-app-secret';
```

\---

## Node-RED Auth Endpoints

|Method|Endpoint|Purpose|
|-|-|-|
|POST|/auth/local|Email/password login|
|POST|/auth/register|New user registration|
|GET|/auth/google|Google OAuth redirect|
|GET|/auth/facebook|Facebook OAuth redirect|
|GET|/auth/\*/callback|OAuth callback → JWT response|

### Expected response format (POST /auth/local):

```json
{
  "token": "eyJhbGc...",
  "user": {
    "id": "user-123",
    "name": "Alice",
    "email": "alice@example.com",
    "provider": "local",
    "avatar": "https://...",
    "role": "admin"
  }
}
```

\---

## Environment Variables

Create `.env` in the project root:

```
NodeRed default URL=http://localhost:1880
```

\---

