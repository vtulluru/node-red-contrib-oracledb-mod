module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: [ '@typescript-eslint' ],
  extends: [ 'eslint:recommended', 'plugin:@typescript-eslint/recommended' ],
  rules: {
    "semi": ["error", "always"], "quotes": ["error", "double"],
    "@typescript-eslint/no-explicit-any": "off", "@typescript-eslint/no-var-requires": "off",
    "no-prototype-builtins": "off", "@typescript-eslint/ban-types": "off",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/no-this-alias": "off",
  }
};