/**
 * Authentication middleware for Azure Functions (Entra ID).
 *
 * Validates Entra ID JWT tokens using JWKS from Microsoft.
 * Checks for roles or custom claims (e.g. "Admin") via the token payload.
 */

import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const TENANT_ID = process.env.ENTRA_TENANT_ID || 'common';
const CLIENT_ID = process.env.ENTRA_CLIENT_ID;

// Create the JWKS client to fetch Microsoft public keys
const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, function(err, key) {
    if (err) {
      callback(err, null);
      return;
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

/**
 * Extract and verify the Entra ID JWT token from the Authorization header.
 *
 * @param {import('@azure/functions').HttpRequest} request
 * @returns {Promise<object|null>} Decoded token payload
 */
export async function verifyAuthToken(request) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.split('Bearer ')[1];
  if (!token) return null;

  return new Promise((resolve) => {
    jwt.verify(token, getKey, {
      audience: CLIENT_ID,
      issuer: `https://sts.windows.net/${TENANT_ID}/`
    }, (err, decoded) => {
      if (err) {
        console.error('[auth] Token verification failed:', err.message);
        resolve(null);
      } else {
        resolve(decoded);
      }
    });
  });
}

/**
 * Require the caller to be an authenticated admin with specific roles.
 *
 * @param {import('@azure/functions').HttpRequest} request
 * @param {string[]} requiredRoles - e.g. ['Admin']
 * @returns {Promise<{user: object, error: object|null}>}
 */
export async function requireAdminClaims(request, requiredRoles = []) {
  const decodedToken = await verifyAuthToken(request);

  if (!decodedToken) {
    return {
      user: null,
      error: { status: 401, body: JSON.stringify({ error: 'Authentication required' }) },
    };
  }

  // Check roles (Entra ID passes roles in the 'roles' array)
  const userRoles = decodedToken.roles || [];
  
  for (const role of requiredRoles) {
    if (!userRoles.includes(role)) {
      return {
        user: null,
        error: {
          status: 403,
          body: JSON.stringify({ error: `Missing required role: ${role}` }),
        },
      };
    }
  }

  return { user: decodedToken, error: null };
}

export function jsonResponse(body, status = 200, headers = {}) {
  return {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export function errorResponse(message, status = 500) {
  return jsonResponse({ error: message }, status);
}
