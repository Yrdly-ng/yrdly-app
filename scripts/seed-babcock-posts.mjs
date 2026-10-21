#!/usr/bin/env node
/**
 * seed-babcock-posts.mjs
 * Fills "Babcock University Connect" with realistic student discussion posts
 * from Sep 29 → Oct 20, averaging 5 posts per day (~110 posts total).
 *
 * Usage:  node scripts/seed-babcock-posts.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── env ──────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""),
    ]),
);

const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const COMMUNITY_ID = "924bcd0f-37ca-438f-9492-efdd4f4f37b9";

// ── helpers ──────────────────────────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/** random datetime within a given UTC day */
function randomTs(date) {
  const d = new Date(date);
  d.setUTCHours(rand(6, 22), rand(0, 59), rand(0, 59), 0);
  return d.toISOString();
}

// ── post content pool ────────────────────────────────────────────────────────
const POSTS = [
  // Campus life
  "Good morning BU fam 🌅 Who's heading to morning devotion today? Let's link up after.",
  "The queue at the cafeteria this morning was absolutely mad. They need to open more serving lines please 😩",
  "Chapel service was so powerful today honestly. That sermon hit different 🙏",
  "Anyone know what time the library closes tonight? I need to camp there till midnight for this Anatomy exam.",
  "Hostel 7 water situation is getting out of hand. We haven't had running water since Tuesday. Can admin please address this?",
  "The wifi in Kolawole hall is totally dead again. How are we supposed to submit our assignments online?? 😤",
  "PSA: Cafeteria is serving jollof rice and fried plantain today. The line is moving fast, go now! 🍛",
  "I just found out they moved the BIO 201 test to Friday. Has anyone else been notified officially?",
  "The new library extension is actually beautiful. Great place to read but please don't come and sleep 😂",
  "Who else feels like BU's electricity situation has improved recently? NEPA sha gave us 2 days straight 🎉",

  // Academics / courses
  "Does anyone have the lecture notes for PHY 102 from last Thursday? I missed class.",
  "Study group for CHM 201 final exam — who's in? Let's meet at the library reading room by 6pm tomorrow.",
  "The BUS 301 assignment deadline has been extended to next Wednesday. Dr. Adeyemi just confirmed in class.",
  "Can anyone recommend a good textbook for LAW 201? The recommended one is out of stock everywhere on campus.",
  "I swear ECO 102 is the hardest course this semester. Anyone have past questions to share?",
  "Results for MCB 301 practical are out! Check the department notice board. Most people passed 🎉",
  "Who's taking NUT 201 this semester? We should form a WhatsApp group for the course.",
  "The registration portal is down again. Has anyone successfully registered their courses for next semester?",
  "Engineering students — the workshop for ENG 302 has been moved to Block D. Spread the word.",
  "Anyone else notice how the BIO 401 lecturer just reads straight from the textbook? We're paying for this 😭",
  "If you haven't picked up your exam card yet, please do so at the bursary before Friday or you can't write.",
  "Has anyone been able to access the new e-library portal? The login keeps failing for me.",
  "The COS 201 assignment is due tomorrow! Who else hasn't started? 😅 Let's help each other.",
  "Congrats to everyone who made the Dean's List for last semester 👏 BU students are doing it!",
  "Reminder: the Health Sciences Seminar is tomorrow at 10am in the Faculty Auditorium. It's compulsory for year 2 students.",

  // Buying / selling
  "Selling my Anatomy & Physiology textbook (Tortora, 15th edition) — ₦8,500. It's in great condition. DM me.",
  "Anyone selling Fundamentals of Accounting by Frank Wood? I need it urgently for tomorrow's class.",
  "I have a barely used scientific calculator (Casio FX-991) for sale — ₦4,000. Serious buyers only.",
  "Looking to buy BCH 201 practicals manual. Who has one they're done with?",
  "Selling a mini fan — perfect for hostel use. ₦3,500. Can deliver within campus.",
  "Laptop charger for HP EliteBook, compatible with 45W adapter. ₦2,500. See me in hostel 3 room 201.",
  "Anyone want to buy gently used law textbooks? I'm graduating and clearing out. Great prices.",
  "Brand new lecture jotter pack (5 books) — ₦1,200 for the set. Cheaper than the campus bookshop.",
  "Looking for a second-hand Biochemistry dictionary. Willing to pay up to ₦3,000.",
  "Selling portable reading lamp — ₦2,000. Very useful for reading during power cuts.",

  // Accommodation / hostel
  "My roommate is looking for a hostel space for next semester. Any leads in Deborah Hall?",
  "Can someone explain how the off-campus accommodation approval process works? I want to move out.",
  "Hostel 4 generator is down again. They said it'll be fixed by tomorrow but we've heard that before 🙄",
  "Anyone in Esther Hall having issues with the bunk beds? Three beds in our room have broken slats.",
  "The bathroom situation in my hostel is really getting me down. They need to hire more cleaners fr.",
  "Looking for a roommate for next session — female, year 2 student preferred. We're 3 in a room of 4.",
  "Off-campus students: how are you managing the shuttle timing in the mornings? It always comes late.",
  "Guys the hostel curfew enforcement is getting strict. Please don't get yourself in trouble.",

  // Social / events
  "BU Cultural Night is next Saturday! 🎭 Who's performing? I heard the drama department has been rehearsing all week.",
  "Just came back from the BU vs. CU football match. We fought hard but lost 2-1. Better luck next time! ⚽",
  "The Medical Students' Association bonfire night was amazing 🔥 Thanks to everyone who made it happen.",
  "Anyone going to the inter-faculty debate competition tomorrow? Let's show up and support our faculty.",
  "Don't forget the end-of-semester thanksgiving in the main auditorium this Friday. Let's pack it out!",
  "Shoutout to the choir for that performance at chapel today 🎶 Y'all had the whole hall on their feet.",
  "The entrepreneurship competition submissions close this weekend. Have you submitted your business idea?",
  "Anyone interested in forming a campus photography club? DM me if you're passionate about photography 📷",
  "BU Annual Sports Day is in 3 weeks. Start training, departments need reps for the 100m and relay! 🏃",
  "The Student Union elections are coming up. Let's make sure we elect people who actually care about us.",

  // Mental health / wellbeing
  "This semester has been genuinely difficult. Just wanted to say — if you're struggling, you're not alone. We'll get through it 💛",
  "Remember to take breaks while studying! Your brain needs rest. Don't forget to eat and hydrate too.",
  "The counselling centre is actually really helpful. Don't be ashamed to book a session if you're overwhelmed.",
  "Exam stress is real. Who's down for a small group prayer session tonight at 9pm in the fellowship hall?",
  "Gentle reminder: you are more than your GPA. Give your best but don't destroy your health doing it.",

  // Finance / bursary
  "School fees deadline is next Monday. If you haven't paid, please do so to avoid being barred from exams.",
  "Anyone know if bursary is still accepting payment plans? I really need to talk to them.",
  "The bursary queue today is terrifying 😭 I've been here for 2 hours. They should just fix the online payment system.",
  "Has anyone been able to successfully pay fees through the portal? It keeps declining my card.",
  "Scholarship application portal is now open for returning students. Check your email for the link!",

  // Technology & campus resources
  "The campus printing centre is out of A4 paper again. Please go early tomorrow if you need to print.",
  "Anyone else's student email refusing to load? ICT department needs to sort this out.",
  "Pro tip: the 4G signal is way better near the Faculty of Science building if you need to use data.",
  "Has anyone tried the new Yrdly app? It's actually great for finding things near campus 👀",
  "The computer lab in block C is open till 10pm on weekdays. Spread the word to those who need computers.",

  // Food
  "The suya spot outside gate 2 is 🔥🔥🔥 If you haven't tried it, you're missing out. ₦500 gets you a solid plate.",
  "Anyone tried the new food vendor by the engineering block? Their rice and stew is actually really good.",
  "The cafeteria beans was surprisingly nice today 😂 Someone give the cook a raise.",
  "I miss mama put outside old gate. Anyone know if she moved? Her egusi soup was unbeatable.",
  "Fasting today and the smell from the cafeteria is testing me right now 😭",

  // Transportation
  "BU shuttle from Ilisan to campus at 7:30am is usually packed. Anyone else taking it — let's coordinate so we don't miss it.",
  "Okada men outside the gate have raised their prices again. From campus to Sagamu junction is now ₦800. 😤",
  "Anyone driving back to Lagos this weekend? I'm looking for a trip to Berger. Happy to contribute fuel money.",
  "The campus minibus schedule for this weekend is up on the notice board. Check before you miss your slot.",

  // Inspiration / general
  "To everyone feeling like they're falling behind — consistency beats perfection. Just show up every day 💪",
  "Remember why you came here. BU isn't easy but we all chose to be here. Make it count.",
  "Halfway through the semester already! Breathe, regroup, and finish strong. We've got this 🎓",
  "Happy new month BU fam 🎉 October is going to be great. Let's set our intentions and crush our goals.",
  "Today I passed my Pharmacology test after failing the first one. Don't let one result define your journey. Keep pushing ❤️",
  "Just finished my final year project proposal submission. Honestly feel like crying happy tears 😭🎉",
  "Submitted my internship application to LUTH today. Fingers crossed 🤞 Pray for me please.",
  "Grateful for this community. BU is tough but the people make it worth it. God bless every one of you 🙏",

  // Complaints (realistic)
  "Why is the timetable always released so late? We're already 2 weeks into semester and some courses still don't have fixed slots.",
  "The security at the gate needs to be more respectful. You can't be shouting at students like that.",
  "Can the students affairs office please update their communication channels? The notice boards are always outdated.",
  "Three of my lecturers haven't shown up for class in two weeks. Who do we report this to officially?",
  "The medical centre ran out of malaria medication again. This is becoming a pattern and it's dangerous.",
  "Why does registration always crash right when everyone needs to use it? ICT please fix this permanently.",

  // Specific study tips
  "If you're struggling with anatomy, YouTube channel 'Armando Hasudungan' is literally gold. Thank me later.",
  "Past questions for most courses are available at the department office for just ₦200. Go get yours ASAP.",
  "Pomodoro technique (25 min study, 5 min break) changed my life during exam prep. Try it if you haven't.",
  "Study tip: form groups of max 4 people. More than that and it becomes a social gathering not a study session 😂",
  "Reading your notes within 24 hours of the lecture improves retention by 80%. Don't sleep on revision.",

  // Misc BU specific
  "Accreditation visit coming up next month — lecturers are being extra strict about attendance. Don't play yourself.",
  "BU annual thanksgiving is looking massive this year. The planning committee has been working so hard.",
  "If you're a first year and feeling overwhelmed, just know that it gets better. Year 2 was my turning point.",
  "Anyone know the new dean's open-door hours? I need to speak to someone in authority about my situation.",
  "The new administrative block is actually impressive. BU is growing and I'm here for it 🙌",
  "Does BU have a lost and found? I left my calculator in the lecture hall yesterday and I need it back.",
];

// Generate the schedule: Sep 29 → Oct 20 = 22 days
function buildSchedule() {
  const start = new Date("2026-09-29T00:00:00Z");
  const end   = new Date("2026-10-20T23:59:59Z");
  const days  = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(new Date(d));
  }

  const slots = [];
  for (const day of days) {
    // Vary between 3 and 8 posts per day, average ~5
    const count = pick([3, 4, 4, 5, 5, 5, 5, 6, 6, 7, 8]);
    for (let i = 0; i < count; i++) {
      slots.push(randomTs(day));
    }
  }
  return slots.sort();
}

async function run() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Seeding posts: Babcock University Connect (Sep29–Oct20) ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  // 1. Load members
  console.log("1. Loading community members…");
  const { data: memberships, error: memErr } = await sb
    .from("community_memberships")
    .select("user_id, role")
    .eq("community_id", COMMUNITY_ID)
    .eq("status", "active");
  if (memErr) throw memErr;

  // Load user profiles
  const userIds = memberships.map((m) => m.user_id);
  const { data: profiles, error: profErr } = await sb
    .from("users")
    .select("id, name")
    .in("id", userIds);
  if (profErr) throw profErr;

  const profileMap = Object.fromEntries(profiles.map((p) => [p.id, p.name]));
  // Exclude admin from regular posting (they still post occasionally)
  const allMembers = memberships.map((m) => ({
    id: m.user_id,
    name: profileMap[m.user_id] || "Student",
    isAdmin: m.role === "admin",
  }));
  const students = allMembers.filter((m) => !m.isAdmin);
  console.log(`   ✅ ${allMembers.length} members loaded (${students.length} students)\n`);

  // 2. Build posting schedule
  console.log("2. Building post schedule…");
  const schedule = buildSchedule();
  console.log(`   ✅ ${schedule.length} post slots generated across 22 days\n`);

  // 3. Insert posts
  console.log("3. Inserting posts…");
  const usedContent = new Set();
  let inserted = 0;
  let failed = 0;

  for (const ts of schedule) {
    // Pick a random student (admin posts ~10% of the time)
    const author = Math.random() < 0.1 ? pick(allMembers) : pick(students);

    // Pick unique content — cycle through if exhausted
    let content;
    const available = POSTS.filter((p) => !usedContent.has(p));
    if (available.length > 0) {
      content = pick(available);
      usedContent.add(content);
    } else {
      // Recycle with slight variation
      usedContent.clear();
      content = pick(POSTS);
      usedContent.add(content);
    }

    const { error } = await sb.from("community_posts").insert({
      community_id: COMMUNITY_ID,
      author_id: author.id,
      author_name: author.name,
      content,
      image_urls: [],
      video_urls: [],
      is_pinned: false,
      is_edited: false,
      like_count: rand(0, 24),
      comment_count: rand(0, 8),
      moderation_status: "approved",
      mentioned_user_ids: [],
      is_announcement: false,
      created_at: ts,
      updated_at: ts,
    });

    if (error) {
      failed++;
      if (failed <= 3) console.error(`   ❌ Insert failed: ${error.message}`);
    } else {
      inserted++;
      if (inserted % 20 === 0) {
        const date = ts.slice(0, 10);
        console.log(`   ✅ ${inserted}/${schedule.length} posts inserted (up to ${date})`);
      }
    }
  }

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`Done! Inserted: ${inserted}  Failed: ${failed}`);
  console.log(`Date range: 2026-09-29 → 2026-10-20`);
  console.log(`Average: ~${(inserted / 22).toFixed(1)} posts/day`);
  console.log(`══════════════════════════════════════════════════════════`);
}

run().catch((err) => {
  console.error("\n💥 Fatal:", err.message);
  process.exit(1);
});
