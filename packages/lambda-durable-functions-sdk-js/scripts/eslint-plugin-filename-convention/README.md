# eslint-plugin-filename-convention

ESLint plugin to enforce kebab-case for file names.

## Usage

Add `filename-convention` to the plugins section of your `.eslintrc.js` configuration file:

```javascript
module.exports = {
  plugins: ["filename-convention"],
  rules: {
    "filename-convention/kebab-case": "error",
  },
};
```

## Rules

### `kebab-case`

This rule enforces that all file names follow the kebab-case naming convention.

Valid file names:

- `user-service.ts`
- `api-gateway.js`
- `auth-middleware.tsx`

Invalid file names:

- `userService.ts` (camelCase)
- `UserService.ts` (PascalCase)
- `user_service.ts` (snake_case)
