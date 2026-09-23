export function createDemoMessages(now = Date.now()) {
  const messages = [
    {
      fromName: 'Olivia Chen', fromEmail: 'olivia@northstar.example', subject: 'Northstar — let’s make something great',
      minutesAgo: 12, read: false, starred: true, labels: ['Work'],
      body: `Hi Alex,\n\nI’m so glad we’re finally kicking this off. We’ve been following your work for a while, and your approach feels like exactly what Northstar needs for this next chapter.\n\nA little context before Thursday: we’re building a calmer way for small teams to manage their money. The product is thoughtful and simple, but our brand hasn’t quite caught up. We want it to feel confident, warm, and unmistakably human.\n\nFor our kickoff, I’d love to cover three things:\n• Who we’re designing for, and what they worry about.\n• The story we want to tell at launch.\n• A realistic timeline for identity and the first website concepts.\n\nDoes Thursday at 10:00 work for you? I’ll bring our founder and a few early customer notes. If you can share a short agenda beforehand, that would be wonderful.\n\nReally looking forward to it,\nOlivia\nBrand Lead · Northstar`,
    },
    {
      fromName: 'Marcus Williams', fromEmail: 'marcus@studio.example', subject: 'A few thoughts on the new direction',
      minutesAgo: 48, read: false, labels: ['Design'],
      body: `Hey Alex,\n\nI spent some time with the latest direction this morning. The softer palette and generous typography are working beautifully together. It feels much more like us.\n\nTwo thoughts before the design review tomorrow:\n\nFirst, the opening section could use a clearer promise. The headline is lovely, but I want someone landing for the first time to understand what we do in five seconds.\n\nSecond, let’s try a version with one large project story instead of three small cards. We have good work; we can give it room to breathe.\n\nNo need to polish everything before the call. A rough alternative will be enough to make a decision together.\n\nThanks for pushing this forward,\nMarcus`,
    },
    {
      fromName: 'Figma Community', fromEmail: 'hello@figma-community.example', subject: 'Your weekly dose of inspiration ✨',
      minutesAgo: 95, read: false, category: 'newsletters', labels: [],
      body: `A little inspiration for your next great idea.\n\nThis week, our community is exploring the spaces between playful and practical: a beautifully simple type specimen, an accessible set of calendar components, and a collection of subtle paper textures.\n\nThe idea worth stealing: start with the smallest useful thing. Before you create a full system, make one screen that helps someone do one thing well. The patterns will reveal themselves.\n\nFor your reading list:\n• Designing forms that feel like a conversation.\n• Why your next prototype should be a little less polished.\n• Five ways to give empty states a purpose.\n\nTake a break, explore something new, and make something you’re proud of.\n\nThe Community team\n\nThis is a fictional newsletter in your Genmail demo inbox.`,
    },
    {
      fromName: 'Sophie Martin', fromEmail: 'sophie@friends.example', subject: 'Lunch next week?',
      minutesAgo: 140, read: true, labels: ['Personal'],
      body: `Hey Alex,\n\nI’ll be in your neighborhood next Tuesday and thought we could finally try that little place you mentioned. The one with the very good noodles and the very small tables?\n\nI’m free from 12:30 until 2. No agenda, no laptops, just a proper catch-up. I want to hear how the studio is going, and I have a mildly ridiculous travel story to tell you.\n\nLet me know if Tuesday works. Wednesday is an option too.\n\nSophie`,
    },
    {
      fromName: 'Daniel Park', fromEmail: 'daniel@launchpad.example', subject: 'We’re live! Thank you for being part of it',
      minutesAgo: 190, read: true, starred: true, labels: ['Work'],
      body: `Alex,\n\nWe pressed the button this morning. Launchpad is officially out in the world.\n\nThe first customer signed up eleven minutes after launch, and our team has been refreshing the dashboard ever since. More than a few people have already mentioned how clear and welcoming the site feels. That’s your work making a difference.\n\nThank you for the patience, the thoughtful questions, and the late-stage detail fixes. You helped us make something we’re genuinely proud to put our name on.\n\nOnce the launch dust settles, let’s get dinner and celebrate. I’ll send a short results update on Friday.\n\nOnward,\nDaniel`,
    },
    {
      fromName: 'Notion', fromEmail: 'updates@notion-demo.example', subject: 'A little more space for your big ideas',
      minutesAgo: 280, read: true, category: 'updates', labels: [],
      body: `Your workspace, a little more organized.\n\nWe’ve put together three simple ways to keep your projects moving this month.\n\n1. Give every project a clear next step. A small action beats a long list of possibilities.\n2. Keep decisions beside the work. Future you will thank you for the context.\n3. Make room for ideas that aren’t ready yet. A good thought doesn’t always arrive on schedule.\n\nTry making a small weekly page for your team: what changed, what needs a decision, and what happens next.\n\nHappy building,\nThe workspace team\n\nThis is a fictional product update in your Genmail demo inbox.`,
    },
    {
      fromName: 'Amelia Brooks', fromEmail: 'amelia@fieldnotes.example', subject: 'The art of noticing',
      minutesAgo: 420, read: true, category: 'newsletters', labels: [],
      body: `Good morning,\n\nOn a walk this weekend, I noticed a hand-painted sign outside a bakery I’ve passed a hundred times. The letters weren’t perfect. The spacing was a little strange. Somehow it was the most memorable thing I saw all day.\n\nWe spend so much time trying to make things consistent that we sometimes forget to make them feel alive.\n\nThis week’s small exercise: take a different route somewhere familiar. Look for one detail you would normally miss. A color combination. A shadow. A sentence overheard at a café.\n\nKeep a note of it. You never know what it might become.\n\nSee you next Sunday,\nAmelia\nField Notes — a fictional weekend newsletter`,
    },
    {
      fromName: 'Ethan Rivera', fromEmail: 'ethan@studio.example', subject: 'Friday review — a quick agenda',
      minutesAgo: 1320, read: false, labels: ['Work'],
      body: `Hi team,\n\nHere’s the plan for our Friday review. We’ll keep it to 30 minutes and leave with decisions, not homework.\n\n• Northstar: choose a direction for the initial moodboards.\n• Studio site: review the revised opening section.\n• Launchpad: capture anything we learned from the launch.\n\nAlex, could you bring the two homepage options? Side-by-side screenshots are plenty.\n\nIf there’s something blocked, add it to the shared notes before 10:00 so we can give it the right amount of time.\n\nThanks,\nEthan`,
    },
    {
      fromName: 'Mia Thompson', fromEmail: 'mia@paperandform.example', subject: 'The print samples are ready',
      minutesAgo: 1500, read: true, labels: ['Design'],
      body: `Hi Alex,\n\nThe first print samples are ready, and I think you’ll be happy with them. The warm white stock brings out the green beautifully.\n\nWe tested both weights you asked for. The lighter one folds more cleanly, while the heavier one feels lovely for the cards. My suggestion is to use each where it does its best work.\n\nYou’re welcome to stop by the workshop any afternoon this week. I’ll set aside the samples and our paper swatch book so we can compare everything in daylight.\n\nNo rush on a final decision. It’s worth seeing these in person.\n\nWarmly,\nMia\nPaper & Form`,
    },
    {
      fromName: 'Oliver James', fromEmail: 'oliver@bookclub.example', subject: 'Something for your weekend reading list',
      minutesAgo: 1740, read: true, labels: ['Personal'],
      body: `Hey Alex,\n\nRemember our conversation about creative routines? I found a collection of interviews with people who make things for a living, and almost all of them describe the same unglamorous habit: showing up before they feel ready.\n\nMy favorite line was about leaving a little unfinished work at the end of the day so it’s easier to begin again tomorrow. I’ve been trying it, and it’s surprisingly helpful.\n\nI’ll bring the book next time we meet. In the meantime, I hope you get a slow morning and a very good coffee this weekend.\n\nOliver`,
    },
    {
      fromName: 'Linear', fromEmail: 'notifications@linear-demo.example', subject: 'Studio website · this week’s progress',
      minutesAgo: 1980, read: true, category: 'updates', labels: ['Work'],
      body: `A small update from the Studio website project.\n\nCompleted this week:\n• Reworked the project navigation.\n• Added keyboard focus states to the main menu.\n• Updated the contact page copy.\n\nUp next:\n• Review the new homepage direction with Marcus.\n• Choose the final case study photography.\n• Check the mobile layout before handoff.\n\nThe project is moving steadily. Your next review is scheduled for Friday.\n\nThis is a fictional project notification in your Genmail demo inbox.`,
    },
    {
      fromName: 'Grace Lee', fromEmail: 'grace@northstar.example', subject: 'A few customer stories before we begin',
      minutesAgo: 2600, read: true, labels: ['Work'],
      body: `Hi Alex,\n\nOlivia mentioned that you’d be helping us with the new identity. Welcome aboard.\n\nI wanted to share something from our customer calls. The thing people mention most isn’t a feature. It’s the relief of finally understanding where their business stands. One founder told us, “I can close my laptop on Friday without worrying about what I’ve missed.”\n\nThat feeling is what we want the brand to carry: capable, reassuring, and human. We don’t need to look like a bank. We need to feel like someone who has your back.\n\nI’ll bring a few more anonymized stories to the kickoff. Looking forward to hearing your thoughts.\n\nGrace\nCo-founder · Northstar`,
    },
    {
      fromName: 'Alex Morgan', fromEmail: 'alex@genmail.example', to: 'daniel@launchpad.example',
      subject: 'Re: We’re live! Thank you for being part of it', minutesAgo: 165, folder: 'sent', read: true,
      replyToId: 'demo-5', labels: ['Work'],
      body: `Daniel,\n\nThis made my day. Congratulations to the whole team! It’s been a pleasure working with people who care so much about getting the details right.\n\nEnjoy the launch moment. Friday’s update sounds great, and dinner is definitely on.\n\nAlex`,
    },
    {
      fromName: 'Isabella Cooper', fromEmail: 'isabella@studio.example', subject: 'All set for the studio gathering',
      minutesAgo: 4300, folder: 'archive', read: true, labels: ['Personal'],
      body: `Hi everyone,\n\nA final note for tomorrow: the table is booked for 7:00, and there’s room for everyone. The restaurant has the dietary notes we collected, so you’re all taken care of.\n\nCome as you are. We’ve earned an evening with good food and absolutely no project updates.\n\nSee you there,\nIsabella`,
    },
    {
      fromName: 'Alex Morgan', fromEmail: 'alex@genmail.example', to: 'olivia@northstar.example',
      subject: 'Re: Northstar — let’s make something great', minutesAgo: 5, folder: 'drafts', read: true,
      replyToId: 'demo-1', labels: ['Work'],
      body: `Hi Olivia,\n\nThursday at 10:00 works perfectly. I’m excited to hear more about Northstar and the people you’re building for.\n\nI’ll send over a short agenda before we meet. It would also be helpful to see any existing brand materials you’re comfortable sharing.\n\nLooking forward to it,\nAlex`,
    },
  ];

  return messages.map(({ minutesAgo, ...message }, index) => ({
    id: `demo-${index + 1}`,
    to: 'alex@genmail.example',
    folder: 'inbox',
    starred: false,
    category: 'primary',
    ...message,
    preview: message.body.replace(/\s+/g, ' ').slice(0, 150),
    date: new Date(now - minutesAgo * 60_000).toISOString(),
  }));
}
