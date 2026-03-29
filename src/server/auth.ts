import jwt from 'jsonwebtoken';
import { parse, serialize } from 'cookie';

const SECRET_KEY = process.env.SECRET_KEY || 'secret-54321';
const COOKIE_NAME = 'sso_token';
const SESSION_DURATION = 24 * 60 * 60; // 1日（秒）

const payload = {
  role: 'user'
};

export const createAuthCookie = () => {
  const token = jwt.sign(payload, SECRET_KEY, {expiresIn: '24h'});
  return serialize(COOKIE_NAME, token, {
    path: '/',
    maxAge: SESSION_DURATION,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
};

export const clearAuthCookie = () => {
  return serialize(COOKIE_NAME, '', {
    path: '/',
    maxAge: -1,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
};

export const verifyAuthCookie = (req: Request): boolean => {
  const cookieHeader = req.headers.get('Cookie');
  if (!cookieHeader) return false;
  const cookies = parse(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) return false;
  try {
    jwt.verify(token, SECRET_KEY, {algorithms: ['HS256']});
    return true;
  } catch {
    return false;
  }
};
