import { Redirect } from 'expo-router';

/** Landing route for the OAuth redirect when the OS delivers it to the router; the auth session reads the URL itself. */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
