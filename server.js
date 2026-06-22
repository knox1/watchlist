const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
const MOVIES_DIR = path.join(__dirname, 'movies');
const TRAILERS_DIR = path.join(__dirname, 'trailers');
const POSTERS_DIR = path.join(__dirname, 'posters');
const DATA_FILE = path.join(__dirname, 'movies.json');
const USERS_FILE = path.join(__dirname, 'users.json');

if (!fs.existsSync(MOVIES_DIR)) fs.mkdirSync(MOVIES_DIR, { recursive: true });
if (!fs.existsSync(TRAILERS_DIR)) fs.mkdirSync(TRAILERS_DIR, { recursive: true });
if (!fs.existsSync(POSTERS_DIR)) fs.mkdirSync(POSTERS_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/posters', express.static(POSTERS_DIR));

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'movie') cb(null, MOVIES_DIR);
    else if (file.fieldname === 'trailer') cb(null, TRAILERS_DIR);
    else if (file.fieldname === 'poster') cb(null, POSTERS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB max
});

// Helper functions
function getMovies() {
  const data = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(data);
}

function saveMovies(movies) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(movies, null, 2));
}

function getUsers() {
  const data = fs.readFileSync(USERS_FILE, 'utf8');
  return JSON.parse(data);
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API Routes

// Get all movies
app.get('/api/movies', (req, res) => {
  const movies = getMovies();
  res.json(movies);
});

// Get single movie
app.get('/api/movies/:id', (req, res) => {
  const movies = getMovies();
  const movie = movies.find(m => m.id === req.params.id);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });
  res.json(movie);
});

// Upload movie
app.post('/api/movies', upload.fields([
  { name: 'movie', maxCount: 1 },
  { name: 'trailer', maxCount: 1 },
  { name: 'poster', maxCount: 1 }
]), (req, res) => {
  try {
    const { title, description, genre, year } = req.body;

    if (!req.files.movie) {
      return res.status(400).json({ error: 'Movie file is required' });
    }

    const movieFile = req.files.movie[0];
    const trailerFile = req.files.trailer ? req.files.trailer[0] : null;
    const posterFile = req.files.poster ? req.files.poster[0] : null;

    const movie = {
      id: uuidv4(),
      title: title || movieFile.originalname,
      description: description || '',
      genre: genre || 'Uncategorized',
      year: year || new Date().getFullYear().toString(),
      filename: movieFile.filename,
      originalName: movieFile.originalname,
      size: movieFile.size,
      trailer: trailerFile ? trailerFile.filename : null,
      poster: posterFile ? posterFile.filename : null,
      uploadedAt: new Date().toISOString()
    };

    const movies = getMovies();
    movies.push(movie);
    saveMovies(movies);

    res.status(201).json(movie);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Delete movie
app.delete('/api/movies/:id', (req, res) => {
  const movies = getMovies();
  const movieIndex = movies.findIndex(m => m.id === req.params.id);

  if (movieIndex === -1) return res.status(404).json({ error: 'Movie not found' });

  const movie = movies[movieIndex];

  // Delete files
  const moviePath = path.join(MOVIES_DIR, movie.filename);
  if (fs.existsSync(moviePath)) fs.unlinkSync(moviePath);

  if (movie.poster) {
    const posterPath = path.join(POSTERS_DIR, movie.poster);
    if (fs.existsSync(posterPath)) fs.unlinkSync(posterPath);
  }

  movies.splice(movieIndex, 1);
  saveMovies(movies);

  res.json({ message: 'Movie deleted' });
});

// Stream trailer (free for everyone)
app.get('/trailer/:id', (req, res) => {
  const movies = getMovies();
  const movie = movies.find(m => m.id === req.params.id);

  if (!movie || !movie.trailer) return res.status(404).send('Trailer not found');

  const trailerPath = path.join(TRAILERS_DIR, movie.trailer);
  if (!fs.existsSync(trailerPath)) return res.status(404).send('File not found');

  const stat = fs.statSync(trailerPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const file = fs.createReadStream(trailerPath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4'
    });
    file.pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
    fs.createReadStream(trailerPath).pipe(res);
  }
});

// User registration
app.post('/api/users/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });

  const users = getUsers();
  if (users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already exists' });

  const user = {
    id: uuidv4(),
    username,
    email,
    password, // In production, hash this!
    subscribed: false,
    subscribedAt: null,
    createdAt: new Date().toISOString()
  };

  users.push(user);
  saveUsers(users);
  res.status(201).json({ id: user.id, username: user.username, email: user.email, subscribed: user.subscribed });
});

// User login
app.post('/api/users/login', (req, res) => {
  const { email, password } = req.body;
  const users = getUsers();
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ id: user.id, username: user.username, email: user.email, subscribed: user.subscribed });
});

// Subscribe user
app.post('/api/users/:id/subscribe', (req, res) => {
  const users = getUsers();
  const user = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.subscribed = true;
  user.subscribedAt = new Date().toISOString();
  saveUsers(users);
  res.json({ id: user.id, username: user.username, subscribed: user.subscribed });
});

// Check subscription before streaming full movie
app.get('/stream/:id', (req, res) => {
  const movies = getMovies();
  const movie = movies.find(m => m.id === req.params.id);

  if (!movie) return res.status(404).send('Movie not found');

  const moviePath = path.join(MOVIES_DIR, movie.filename);

  if (!fs.existsSync(moviePath)) return res.status(404).send('File not found');

  const stat = fs.statSync(moviePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const file = fs.createReadStream(moviePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4'
    });

    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4'
    });

    fs.createReadStream(moviePath).pipe(res);
  }
});

// Download movie
app.get('/download/:id', (req, res) => {
  const movies = getMovies();
  const movie = movies.find(m => m.id === req.params.id);

  if (!movie) return res.status(404).send('Movie not found');

  const moviePath = path.join(MOVIES_DIR, movie.filename);

  if (!fs.existsSync(moviePath)) return res.status(404).send('File not found');

  res.download(moviePath, movie.originalName);
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎬 Watchlist is running!`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://0.0.0.0:${PORT}`);
  console.log(`\n   Share your public URL for internet access.\n`);
});
