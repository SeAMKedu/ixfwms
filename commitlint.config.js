export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subjects often start with names like SQLite, REST or MCP.
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
