/**
 * English template lines for players using the English UI. Same keys and
 * placeholders as DEFAULT_TEMPLATES; personality-specific templates are
 * Chinese-only, so English tables use these defaults.
 */
import type { TemplateSet } from './types';

export const EN_TEMPLATES: Record<string, TemplateSet> = {
  'handStart.other': {
    mild: ["Here we go.", "Let's make this one count.", 'New hand, new luck!'],
    spicy: ['Ready to lose some coins?', "Who's paying for everyone today?"],
  },
  'dingque.other': { mild: ["Void picked, let's play.", "Don't need that suit anyway."] },
  'pong.subject': { mild: ['Pong! Thanks.', "I'll take that."], spicy: ['Lovely gift, send another.', 'Thank you, boss!'] },
  'pong.object': { mild: ['Aw, ponged.', 'Oh well.'], spicy: ['Pong pong pong, is that all you do?'] },
  'pong.other': { mild: ['Ooh, a pong.'] },
  'kong.subject': { mild: ['Kong! Pay up, everyone.', 'A kong, very nice.'], spicy: ['Kong! Wallets out, folks.'] },
  'kong.object': { mild: ['Another kong off me…', 'Ugh, I fed a kong.'] },
  'kong.other': { mild: ['Another kong? Lucky you.'], spicy: ['All those kongs — careful, they can backfire.'] },
  'win.subject': { mild: ['Self-draw! Sorry, everyone.', "That's a win, thank you kindly."], spicy: ['Self-draw! Take your time, you three.', "I'm out — enjoy the bloodbath."] },
  'win.other': { mild: ['Self-drawn? Impressive.', 'Sigh, paying again.'], spicy: ['Pure luck, that.'] },
  'dealtIn.subject': { mild: ['Win! Thanks, {object}.', 'Exactly the tile I wanted!'], spicy: ['What a gift, {object}!', "{object}, you're too generous."] },
  'dealtIn.object': { mild: ['Oops, I dealt in…', 'You won on THAT?'], spicy: ["Consider it charity.", 'Lucky shot.'] },
  'dealtIn.other': { mild: ['{object} dealt in.'], spicy: ['{object}, you threw THAT?', '{object} is handing out points again.'] },
  'bigWin.subject': { mild: ['Big hand! {fan} fan!', 'Worth the wait!'], spicy: ['{fan} fan. Any questions?'] },
  'bigWin.object': { mild: ["A hand that big… I'm crying."], spicy: ['Are you cheating or what?'] },
  'bigWin.other': { mild: ['Wow, {fan} fan, nice.'], spicy: ["That's a ridiculous hand…"] },
  'robbedKong.object': { mild: ['My kong got robbed?!', 'Noo, my kong…'] },
  'robbedKong.other': { mild: ['Robbing the kong! Beautiful.'] },
  'dangerousDiscard.other': {
    mild: ['{subject}, that one looks risky.', 'Bold move.'],
    spicy: ['{subject}, you dare throw that?', 'Throwing that? Respect.'],
  },
  'huaZhu.subject': { mild: ['Ugh, Flower Pig…'] },
  'huaZhu.other': { mild: ["Someone's a Flower Pig."], spicy: ['{subject} is the Flower Pig, ha!'] },
  'handEnd.other': { mild: ['On to the next one.', 'Alright, again.'], spicy: ["I'm winning it all back next hand."] },
  'idle.other': {
    mild: ['Nice weather today.', "Just play, don't overthink it.", 'This is getting tricky.'],
    spicy: ['You lot are so slow.', 'Someone is sitting on a big hand. I can smell it.'],
  },
  'playerChat.other': { mild: ['Haha, focus on the game.', 'Fair point.', 'Mm-hm.'], spicy: ['Less talking, more discarding.'] },
  'playerQuickPhrase.other': { mild: ['Okay, okay.', 'Got it.'], spicy: ["Stop rushing me."] },
  'playerSticker.other': { mild: ['Haha.'] },
  'aiSpoke.other': { mild: ["You're right.", 'Not so sure about that.'], spicy: ['Yeah, keep dreaming.'] },
  'reunion.grudge': {
    mild: ["You again? I haven't forgotten last time.", "{player}, we still have a score to settle."],
    spicy: ['You again? You wrecked me last time — revenge is coming.', "{player}, small world. Let's see how you do this time."],
  },
  'reunion.rival': { mild: ['Old rivals meet again.', '{player}, you and me again.'], spicy: ["You again — let's see who laughs last."] },
  'reunion.beaten': { mild: ["{player}, you beat me last time. Not today.", "Don't get too lucky now."], spicy: ["I'm winning back everything I lost to you."] },
  'reunion.beatThem': { mild: ['{player}, here to donate more points?', 'Old friend, go easy on me.'], spicy: ['You again? I crushed you last time.'] },
  'reunion.friendly': { mild: ['{player}, long time no see!', 'Hey, playing together again.'] },
  'memory.dealtInAgain': { mild: ['You fed me again, just like last time.', '{player}, why do you keep feeding me?'], spicy: ['{player}, are you here just to give me points?'] },
  'memory.lostAgain': { mild: ['You got me again… same as last time.', '{player}, are you targeting me?'], spicy: ["You again! I won't forget this."] },
  'intent.bluffCloseToWin': { mild: ["I'm almost ready, watch out.", 'This one is in the bag.'], spicy: ["I'm about to win, get your coins ready."] },
  'intent.complainBadHand': { mild: ['These tiles are hopeless…', 'Terrible luck today.'] },
  'intent.feignIndifference': { mild: ['{suit}? Not interested.', "Throw all the {suit} you want, I don't need them."] },
  'intent.honestGood': { mild: ['This hand has potential.', 'Not bad tiles.'] },
  'intent.honestBad': { mild: ['Meh, so-so hand today.', 'Probably no chance this hand.'] },
};
