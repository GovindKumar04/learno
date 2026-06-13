import { OAuth2Client } from "google-auth-library";

// Verifies Google ID tokens sent from the frontend. GOOGLE_CLIENT_ID must match
// the OAuth 2.0 Web client used by the browser (it's the token's audience).
export const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
