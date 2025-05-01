import '../styles/globals.css'; // Path relative to pages/_app.tsx

import type { AppProps } from 'next/app';

function MyApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}

export default MyApp;