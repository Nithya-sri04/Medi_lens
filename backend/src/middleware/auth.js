import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'medilens-dev-secret-change-in-production';

/**
 * Verify Bearer token and attach user to req.user (userId, email).
 */
export const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Missing or invalid token' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { userId: payload.userId, email: payload.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' });
  }
};

export { JWT_SECRET };
