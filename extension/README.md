# AppFill — Job Application Autofill

A Chrome extension that fills job applications from the right-click menu.

## Install (2 minutes)
1. Unzip this folder somewhere permanent (Chrome loads it from that spot).
2. Go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `appfill` folder.
4. The settings page opens. Fill in your info. It saves as you type.

## Use it
Right-click anywhere on an application page:

- **Fill this application** fills every empty field it recognizes. Filled fields flash green, and anything it couldn't place gets an amber outline.
- **Fill this field with… ▸** (right-click inside a field) lets you pick any profile value or custom answer for that one field. It replaces what's already there.
- **Remember my answers on this site** saves every answer on the page after you finish a form by hand. Next time on that site, those fields fill too, including odd dropdowns, radio buttons and checkboxes. This works best on ATS hosts like `boards.greenhouse.io` or `jobs.lever.co`, where every company's form looks the same.
- **Forget answers for this site** clears those saved answers.
- **Check this form for hidden fields** looks for trap fields: inputs a page has made invisible (see-through, a few pixels wide, or pushed off the screen) that ask for something in your profile. Some sites use them to catch spam bots, others to collect details you can't see. AppFill never fills them, and every fill also tells you if it found any.

## How it decides what goes where
In order:
1. Answers you saved for this site
2. The field's `autocomplete` hint
3. Your custom answers (keyword match)
4. Built-in rules that read the field's label, placeholder, name and surrounding question text

It only fills empty fields, and only in the frame you right-clicked. Answers saved with Remember skip private fields like Social Security, date of birth, bank and card numbers. It never touches password or file-upload fields. It only ticks checkboxes you've saved for that site.

## Custom answers
Under "Question contains", list comma-separated phrases. A phrase matches when all of its words appear in the question. For example, `why do you want, why are you interested` matches "Why do you want to work at Acme?". Longer phrases beat shorter ones when several match.

## Limits
- Fancy dropdowns that aren't real `<select>` elements, like Workday's or some React "type to search" boxes, get outlined amber rather than filled. Fill them by hand.
- Resume uploads stay manual. Browsers don't let extensions attach files.

## Privacy
Everything is stored in `chrome.storage.local` on this computer. Nothing is sent anywhere. Use **Export settings** to back it up or move it to another machine.
