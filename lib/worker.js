const cors = require('cors');
const API = require('lol-riot-api-module');
const routes = require('./routes');
const express = require('express');
const redis = require('redis');
const apicache = require('apicache');
const RateLimit = require('express-rate-limit');
const helmet = require('helmet');
const pkg = require('../package.json');
const session = require('cookie-session');
const parseurl = require('parseurl');
const app = express();
const cache = apicache.middleware;

const limiter = new RateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 1000, // limit each IP to 100 requests per windowMs
    delayMs: 0 // disable delaying - full speed until the max limit is reached
});

// Set default cache options
apicache.options({
    statusCodes: {
        exclude: [404, 429, 500],
        include: [200, 304]
    }
});

module.exports = cfg => {
    const api = new API({
        key: cfg.apiKey || null,
        region: cfg.region || null
    });

    // Enable redis caching if enabled
    if (cfg.cache === 'redis') {
        apicache.options({
            redisClient: redis.createClient(process.env.REDIS_URL)
        });
    }

    /**
     * Handles request made to the API server
     *
     * @param {http.IncomingMessage} req
     * @param {http.ServerResponse} res
     */
    const requestHandler = (req, res) => {
        const options = Object.assign({}, req.query, req.params);
        const path = req.route.path;
        const method = routes[path].method;
        const hasCache = routes[path].cache;

        // Create cache groups
        if (hasCache) {
            if (path.startsWith('/account')) {
                req.apicacheGroup = `accountId-${req.params.accountId}`;
            } else if (path.startsWith('/summoner')) {
                req.apicacheGroup = `summonerId-${req.params.accountId}`;
            }
        }

        api[method](options, (error, data) => {
            res.set('Content-Type', 'application/json');
            if (error) {
                res.status(error.code).json({
                    code: error.code,
                    message: error.message
                });
                return;
            }
            res.status(200).json(data);
        });
    };

    /**********************************************************************************/

    app.use(cors());

    // Secure the API with helmet. Readmore: https://expressjs.com/en/advanced/best-practice-security.html
    app.use(helmet());
    app.disable('x-powered-by');

    // only if you're behind a reverse proxy (Heroku, Bluemix, AWS if you use an ELB, custom Nginx setup, etc)
    app.set('trust proxy', 1) // trust first proxy

    // Configure session
    const expiryDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    app.use(session({
        name: 'p8vZNQf7AJknqH7dg4tScSBeZhRRk6tx',
        keys: ['key1', 'key2'],
        cookie: {
            secure: true,
            httpOnly: true,
            expires: expiryDate
        }
    }));

    app.use(limiter);

    app.port = process.env.PORT || 3001;

    /**********************************************************************************/

    // Default route
    app.get('/', cache('1 day'), (req, res) => {
        res.set('Content-Type', 'application/json');
        res.status(200).json({
            name: 'League of Legends API',
            version: pkg.version,
            author: pkg.author,
            contributors: pkg.contributors,
            repository: pkg.repository.url
        });
    });

    // Cache cleaning
    app.get('/clear-cache/account/:accountId', (req, res) => {
        apicache.clear(`accountId-${req.params.accountId}`);
        res.set('Content-Type', 'application/json');
        res.status(200).json({
            message: 'Cache cleared'
        });
    });

    // Cache cleaning
    app.get('/clear-cache/summoner/:summonerId', (req, res) => {
        apicache.clear(`summonerId-${req.params.summonerId}`);
        res.set('Content-Type', 'application/json');
        res.status(200).json({
            message: 'Cache cleared'
        });
    });

    // Dynamic API routes with cache
    Object.keys(routes).forEach(route => {
        app.get(route, cache(route.cache), requestHandler);
    });

    // Error Handling
    app.use((req, res) => {
        res.set('Content-Type', 'application/json');
        res.status(404).json({
            error: 404,
            message: 'Not Found'
        });
    });

    app.use((req, res) => {
        res.set('Content-Type', 'application/json');
        res.status(500).json({
            error: 500,
            message: 'Internal Server Error'
        });
    });

    app.use((req, res) => {
        res.set('Content-Type', 'application/json');
        res.status(429).json({
            error: 429,
            message: 'Too many requests'
        });
    });

    /**********************************************************************************/

    // Listening
    app.listen(app.port, () => console.log(`League of Legends API is listening on port ${app.port}`));
};
