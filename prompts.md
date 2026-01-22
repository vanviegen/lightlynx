
Please consider if using https://aberdeenjs.org/dispatcher/Dispatcher/ would simplify our code in app.ts.



Big task: I want you to completely restructure the HTML and the CSS for this project. Here's what I'd like to see:
- Less clutter in the HTML structure - simplify things!
- No more style.css. Instead...
  - Use inline Aberdeen styling for component-specific styles.
  - Use Aberdeen insertCss for component-specific styles that are too large for inline, would be repetitive, or benefit from combined selectors (for instance depending on parent class) and pseudo classes (like first-child and hover). Generally, you'll want to do one insert for each component (draw* function), assigning the class name to the top level element of the component, and using inner selectors to match elements within that component.
  - Use Aberdeen insertGlobalCss for global styles like resets, typography.
- As you'll be rewriting just about all client-side .ts anyway, please split it into smaller files. Most draw*Page functions probably deserve their own file (named something like xyz-page.ts). Try to group utility draw* functions that are used by more than one page together, like we're already doing with color-picker.ts).
- Use standard Aberdeen sizes like $3 and $4 for spacing. You'll need to call setSpacingCssVars once to apply them.
- Define CSS custom props using Aberdeen's `cssVars` for colors (like 'primary') and other design tokens.
- The looks should may become more minimalistic and modern. The striped background can go out. I do want to maintain the current primary color and an overall warmish dark aesthetic, matching the logo (which won't be changing.)
- So I want style.css removed entirely and I want a restrained use of insertGlobalCss.
- Please make sure the (limited) global style does a bit of CSS reset and uses semantic HTML tags where appropriate to provide a reasonable baseline for the app. Also, make sure to offer a coherent way to manage spacing (margins/paddings) in a way that will usually make sense, but can be overriden (with things like mv:3) when needed. But keep it simple and minimal. Use modern system-native fonts everywhere by default. Provide some global css tags for forms and form elements, and how they should look.
- Define the global style in a separate file called `global-style.ts`.
- Use Aberdeen's `darkMode(): boolean` method within an observe scope with an if to define custom color css vars fork light mode and dark mode colors.
- You can use the playwright MCP agent to take screenshots and see how your work looks. You can also run the tests (which you may need to adapt if the html structures changes), as they'll output png files for every step, that you can inspect. That way you can iterate to something that looks great!

Steps:
- This project uses Aberdeen. Study the Skill to make sure you understand how to use it effectively.
- Formulate a plan regarding global style: how to handle spacing, what will be part of the global style, what will be part of the component style, and what will be inline style. Write this to a new file DESIGN.md
- Formulate the goals for the looks you are going for, and how to achieve them. Add this to DESIGN.md
- Create src/global-style.ts
- Extract pages and (sets of) components out of app.ts into new files, writing them into new files in src/, and applying the new style and structure on them.
- Also apply this style and structure on the remainder of app.ts and on color-picker.ts.
- Get the test to run again.
- Iterate looking at some test output png and improving the styling.
- Optionally, also use MCP playwright to look at some pages that are not (yet) part of the tests.

