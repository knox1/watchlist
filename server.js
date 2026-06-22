const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const MOVIES_DIR = path.join(__dirname, 'movies');
const TRAILERS_DIR = path.join(__dirname, 'trailers');
const POSTERS_DIR = path.join(__dirname, 'posters');
const DATA_FILE = path.join(__dirname, 'movies.json');
const USERS_FILE = path.join(__dirname, 'users.json');

[MOVIES_DIR, TRAILERS_DIR, POSTERS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/posters', express.static(POSTERS_DIR));

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'movie') cb(null, MOVIES_DIR);
    else if (file.fieldname === 'trailer') cb(null, TRAILERS_DIR);
    else if (file.fieldname === 'poster') cb(null, POSTERS_DIR);
  },
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 * 1024 } });

// Helpers
function getMovies() { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function saveMovies(m) { fs.writeFileSync(DATA_FILE, JSON.stringify(m, null, 2)); }
function getUsers() { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }

// Admin page
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ============ MOVIE APIs ============

// Get all movies (with view counts for trending)
app.get('/api/movies', (req, res) => res.json(getMovies()));

// Get single movie
app.get('/api/movies/:id', (req, res) => {
  const movie = getMovies().find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Not found' });
  res.json(movie);
});

// Upload movie (admin)
app.post('/api/movies', upload.fields([
  { name: 'movie', maxCount: 1 },
  { name: 'trailer', maxCount: 1 },
  { name: 'poster', maxCount: 1 }
]), (req, res) => {
  try {
    const { title, description, genre, year, duration, cast } = req.body;
    if (!req.files.movie) return res.status(400).json({ error: 'Movie file required' });

    const movieFile = req.files.movie[0];
    const trailerFile = req.files.trailer ? req.files.trailer[0] : null;
    const posterFile = req.files.poster ? req.files.poster[0] : null;

    const movie = {
      id: uuidv4(),
      title: title || movieFile.originalname,
      description: description || '',
      genre: genre || 'Uncategorized',
      year: year || new Date().getFullYear().toString(),
      duration: duration || '',
      cast: cast || '',
      filename: movieFile.filename,
      originalName: movieFile.originalname,
      size: movieFile.size,
      trailer: trailerFile ? trailerFile.filename : null,
      poster: posterFile ? posterFile.filename : null,
      views: 0,
      ratings: [],
      comments: [],
      uploadedAt: new Date().toISOString()
    };

    const movies = getMovies();
    movies.push(movie);
    saveMovies(movies);
    res.status(201).json(movie);
  } catch (e) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Delete movie (admin)
app.delete('/api/movies/:id', (req, res) => {
  const movies = getMovies();
  const i = movies.findIndex(m => m.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  const movie = movies[i];
  const moviePath = path.join(MOVIES_DIR, movie.filename);
  if (fs.existsSync(moviePath)) fs.unlinkSync(moviePath);
  if (movie.poster) { const p = path.join(POSTERS_DIR, movie.poster); if (fs.existsSync(p)) fs.unlinkSync(p); }
  if (movie.trailer) { const t = path.join(TRAILERS_DIR, movie.trailer); if (fs.existsSync(t)) fs.unlinkSync(t); }
  movies.splice(i, 1);
  saveMovies(movies);
  res.json({ message: 'Deleted' });
});

// Rate a movie
app.post('/api/movies/:id/rate', (req, res) => {
  const { userId, rating } = req.body;
  if (!userId || !rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Invalid rating' });
  const movies = getMovies();
  const movie = movies.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Not found' });
  const existing = movie.ratings.findIndex(r => r.userId === userId);
  if (existing >= 0) movie.ratings[existing].rating = rating;
  else movie.ratings.push({ userId, rating });
  saveMovies(movies);
  const avg = movie.ratings.reduce((a, r) => a + r.rating, 0) / movie.ratings.length;
  res.json({ averageRating: avg.toFixed(1), totalRatings: movie.ratings.length });
});

// Comment on a movie
app.post('/api/movies/:id/comment', (req, res) => {
  const { userId, username, text } = req.body;
  if (!userId || !text) return res.status(400).json({ error: 'Invalid comment' });
  const movies = getMovies();
  const movie = movies.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Not found' });
  const comment = { id: uuidv4(), userId, username, text, createdAt: new Date().toISOString() };
  movie.comments.push(comment);
  saveMovies(movies);
  res.status(201).json(comment);
});

// Track view (increment view count)
app.post('/api/movies/:id/view', (req, res) => {
  const movies = getMovies();
  const movie = movies.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Not found' });
  movie.views = (movie.views || 0) + 1;
  saveMovies(movies);
  res.json({ views: movie.views });
});


// ============ USER APIs ============

// Register
app.post('/api/users/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  const users = getUsers();
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already exists' });
  const user = {
    id: uuidv4(), username, email, password,
    subscribed: false, subscribedAt: null,
    favorites: [], watchProgress: [],
    createdAt: new Date().toISOString()
  };
  users.push(user);
  saveUsers(users);
  res.status(201).json({ id: user.id, username: user.username, email: user.email, subscribed: user.subscribed, favorites: user.favorites });
});

// Login
app.post('/api/users/login', (req, res) => {
  const { email, password } = req.body;
  const user = getUsers().find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ id: user.id, username: user.username, email: user.email, subscribed: user.subscribed, favorites: user.favorites || [] });
});

// Subscribe
app.post('/api/users/:id/subscribe', (req, res) => {
  const users = getUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.subscribed = true;
  user.subscribedAt = new Date().toISOString();
  saveUsers(users);
  res.json({ id: user.id, username: user.username, subscribed: user.subscribed });
});

// Toggle favorite
app.post('/api/users/:id/favorite', (req, res) => {
  const { movieId } = req.body;
  const users = getUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.favorites) user.favorites = [];
  const idx = user.favorites.indexOf(movieId);
  if (idx >= 0) user.favorites.splice(idx, 1);
  else user.favorites.push(movieId);
  saveUsers(users);
  res.json({ favorites: user.favorites });
});

// Save watch progress
app.post('/api/users/:id/progress', (req, res) => {
  const { movieId, progress, duration } = req.body;
  const users = getUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (!user.watchProgress) user.watchProgress = [];
  const existing = user.watchProgress.findIndex(w => w.movieId === movieId);
  if (existing >= 0) { user.watchProgress[existing].progress = progress; user.watchProgress[existing].duration = duration; }
  else user.watchProgress.push({ movieId, progress, duration, updatedAt: new Date().toISOString() });
  saveUsers(users);
  res.json({ watchProgress: user.watchProgress });
});

// Get user profile (with progress and favorites)
app.get('/api/users/:id', (req, res) => {
  const user = getUsers().find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, username: user.username, email: user.email, subscribed: user.subscribed, favorites: user.favorites || [], watchProgress: user.watchProgress || [] });
});

// Admin stats
app.get('/api/stats', (req, res) => {
  const movies = getMovies();
  const users = getUsers();
  const subscribers = users.filter(u => u.subscribed).length;
  const totalViews = movies.reduce((a, m) => a + (m.views || 0), 0);
  const trending = [...movies].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 5);
  res.json({ totalMovies: movies.length, totalUsers: users.length, subscribers, totalViews, trending });
});


// ============ STREAMING ============

// Stream trailer (free)
app.get('/trailer/:id', (req, res) => {
  const movie = getMovies().find(m => m.id === req.params.id);
  if (!movie || !movie.trailer) return res.status(404).send('Trailer not found');
  streamFile(path.join(TRAILERS_DIR, movie.trailer), req, res);
});

// Stream full movie
app.get('/stream/:id', (req, res) => {
  const movie = getMovies().find(m => m.id === req.params.id);
  if (!movie) return res.status(404).send('Not found');
  streamFile(path.join(MOVIES_DIR, movie.filename), req, res);
});

// Download movie
app.get('/download/:id', (req, res) => {
  const movie = getMovies().find(m => m.id === req.params.id);
  if (!movie) return res.status(404).send('Not found');
  const p = path.join(MOVIES_DIR, movie.filename);
  if (!fs.existsSync(p)) return res.status(404).send('File not found');
  res.download(p, movie.originalName);
});

// Helper: stream with range support
function streamFile(filePath, req, res) {
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4'
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
    fs.createReadStream(filePath).pipe(res);
  }
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 Watchlist is running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://0.0.0.0:${PORT}`);
  console.log(`   Admin:   http://localhost:${PORT}/admin\n`);
});
