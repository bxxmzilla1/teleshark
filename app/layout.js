import "./globals.css";
import RegisterSW from "./register-sw";

export const metadata = {
  title: "MultiGram",
  description: "View chats from multiple Telegram accounts",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MultiGram",
  },
};

export const viewport = {
  themeColor: "#0e1621",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  );
}
