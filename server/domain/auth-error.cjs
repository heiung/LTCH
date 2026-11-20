'use strict';

class AuthError extends Error {
  constructor(code, message, status = 401, retryAfter = undefined) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

module.exports = { AuthError };
