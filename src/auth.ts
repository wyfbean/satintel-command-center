import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import MicrosoftEntra from "next-auth/providers/microsoft-entra-id";
import Credentials from "next-auth/providers/credentials";
import { getSQLiteAdapter } from "@/lib/auth/sqlite-adapter";
import { verifyPassword } from "@/lib/auth/password";
import { getDb } from "@/lib/intel/db";

type UserRow = { id: string; email: string; name: string; password_hash: string };

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: getSQLiteAdapter(),
  providers: [
    Credentials({
      credentials: {
        email:    { label: "邮箱", type: "email" },
        password: { label: "密码", type: "password" },
      },
      async authorize(credentials) {
        const email    = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const db = getDb();
        if (!db) return null;

        const user = db
          .prepare("SELECT id, email, name, password_hash FROM users WHERE email = ?")
          .get(email) as UserRow | undefined;

        if (!user?.password_hash) return null;
        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),

    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [Google({
          clientId:     process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
          // Google verifies email ownership, so linking same-email accounts across
          // providers is safe.  Without this flag NextAuth throws OAuthAccountNotLinked
          // when the same email already exists under a different provider.
          allowDangerousEmailAccountLinking: true,
        })]
      : []),

    ...(process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET
      ? [MicrosoftEntra({
          clientId:     process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
          clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
          allowDangerousEmailAccountLinking: true,
          ...(process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID
            ? { issuer: `https://login.microsoftonline.com/${process.env.AUTH_MICROSOFT_ENTRA_ID_TENANT_ID}/v2.0` }
            : {}),
        })]
      : []),
  ],

  session: { strategy: "jwt" },
  trustHost: true,

  callbacks: {
    async jwt({ token, user }) {
      // user is only populated on the initial sign-in event
      if (user?.id) token.id = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.id) session.user.id = token.id as string;
      return session;
    },
  },

  pages: { signIn: "/signin" },
});
