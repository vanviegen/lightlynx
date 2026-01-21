
Please consider if using https://aberdeenjs.org/dispatcher/Dispatcher/ would simplify our code in app.ts.


Big task: I want you to completely restructure the HTML and the CSS for this project. Here's what I'd like to see:
- Less clutter in the HTML structure - simplify things!
- No more style.css. Instead...
  - Use inline Aberdeen styling for component-specific styles.
  - Use Aberdeen insertCss for component-specific styles that are too large for inline, would be repetitive, or benefit from combined selectors (for instance depending on parent class) and pseudo classes (like first-child and hover).
  - Use Aberdeen insertGlobalCss for global styles like resets, typography.
- Use standard Aberdeen sizes like @3 and @4 for spacing.
- Define CSS custom props using Aberdeen's `cssVars` for colors (like 'primary') and other design tokens.
- The looks should may become more minimalistic and modern. The striped background can go out. I do want to maintain the current primary color and an overall warmish dark aesthetic, matching the logo (which won't be changing.)

So I want style.css removed entirely and I want a restrained use of insertGlobalCss.

This project uses Aberdeen. Study the Skill to make sure you understand how to use it effectively.
