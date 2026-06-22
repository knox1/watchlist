const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
const MOVIES_DIR = path.join(__dirname, 'movies');
const POSTERS_DIR = path.join(__dirname, 'posters');
const DATA_FILE = path.join(__dirname, 'movies.json');

if (!fs.existsSync(MOVIES_DIR)) fs.mkdirSync(MOVIES_DIR, { recursive: true });
if (!fs.existsSync(POSTERS_DIR)) fs.mkdirSync(POSTERS_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/posters', express.static(POSTERS_DIR));

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'movie') cb(null, MOVIES_DIR);
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
  { name: 'poster', maxCount: 1 }
]), (req, res) => {
  try {
    const { title, description, genre, year } = req.body;

    if (!req.files.movie) {
      return res.status(400).json({ error: 'Movie file is required' });
    }

    const movieFile = req.files.movie[0];
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

// Stream movie (supports range requests for seeking)
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
