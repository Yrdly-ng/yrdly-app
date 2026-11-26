import type { Metadata } from "next";

type ProfileMetadataProps = {
  params: Promise<{ userId: string }>;
};

type PublicProfileMetadata = {
  name?: string | null;
  username?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
};

export async function generateMetadata({ params }: ProfileMetadataProps): Promise<Metadata> {
  const { userId } = await params;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const fallbackTitle = "Profile on YRDLY";
  const fallbackDescription = "Connect with people and discover your neighborhood on YRDLY.";

  if (!supabaseUrl || !supabaseAnonKey) {
    return { title: fallbackTitle, description: fallbackDescription };
  }

  try {
    const endpoint = new URL("/rest/v1/public_profiles", supabaseUrl);
    endpoint.searchParams.set("id", "eq." + userId);
    endpoint.searchParams.set("select", "name,username,bio,avatar_url");

    const response = await fetch(endpoint.toString(), {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: "Bearer " + supabaseAnonKey,
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return { title: fallbackTitle, description: fallbackDescription };
    }

    const profiles = (await response.json()) as PublicProfileMetadata[];
    const profile = profiles[0];
    if (!profile) {
      return { title: "Profile not found | YRDLY", description: fallbackDescription };
    }

    const name = profile.name?.trim() || profile.username?.trim() || "YRDLY member";
    const title = name + " on YRDLY";
    const description =
      profile.bio?.trim().slice(0, 180) ||
      "View " + name + "'s profile, posts and community activity on YRDLY.";
    const images = profile.avatar_url ? [{ url: profile.avatar_url }] : [{ url: "/logo.png" }];

    return {
      title,
      description,
      openGraph: { title, description, type: "profile", images },
      twitter: { card: "summary", title, description, images },
    };
  } catch {
    return { title: fallbackTitle, description: fallbackDescription };
  }
}

export default function SharedProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
