// logger.js
const { createLogger, format, transports } = require('winston');

// configure logger
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),   // include error stack
    format.json()
  ),
  transports: [
    // write all logs with level `info` and below to combined.log
    new transports.File({ filename: 'logs/combined.log' }),
    // write all logs with level `error` and below to error.log
    new transports.File({ filename: 'logs/error.log', level: 'error' }),
  ],
});

// in development, also log to console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    )
  }));
}

module.exports = logger;