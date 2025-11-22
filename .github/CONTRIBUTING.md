# Contributing to CyberMinds

Thank you for your interest in contributing to CyberMinds! We welcome contributions from everyone who wants to help make cybersecurity education more accessible.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Getting Started](#getting-started)
- [Development Guidelines](#development-guidelines)
- [Pull Request Process](#pull-request-process)
- [Style Guide](#style-guide)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment. We expect all contributors to:

- Be respectful and considerate
- Welcome newcomers and help them learn
- Accept constructive criticism gracefully
- Focus on what is best for the community and project

## How Can I Contribute?

### Reporting Bugs

- Check if the bug has already been reported in [Issues](https://github.com/Cyber-Minds/CyberMinds/issues)
- If not, create a new issue with:
  - A clear, descriptive title
  - Steps to reproduce the bug
  - Expected vs actual behavior
  - Screenshots if applicable
  - Browser/OS information

### Suggesting Features

- Open an issue with the `enhancement` label
- Describe the feature and its benefits
- Include mockups or examples if possible

### Contributing Code

- Fix bugs
- Add new features
- Improve documentation
- Enhance existing courses
- Create new course content

### Improving Documentation

- Fix typos and grammatical errors
- Improve clarity of existing documentation
- Add missing documentation

## Getting Started

1. **Fork the repository**
   ```bash
   git clone https://github.com/YOUR-USERNAME/CyberMinds.git
   ```

2. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

3. **Make your changes**

4. **Test your changes**
   - Open the HTML files in a browser
   - Test on multiple browsers if possible
   - Ensure responsive design works

5. **Commit your changes**
   ```bash
   git commit -m "Brief description of changes"
   ```

6. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

7. **Open a Pull Request**

## Development Guidelines

### Project Structure

```
CyberMinds/
├── index.html              # Home page
├── HTML/                   # HTML pages
│   └── Courses and Activities/  # Course content
├── CSS/                    # Stylesheets
│   └── Courses and Activities/  # Course styles
├── Javascript/             # Scripts
├── Images/                 # Assets
└── .github/                # GitHub templates
```

### Adding New Course Content

1. Create HTML file in `HTML/Courses and Activities/Course X/`
2. Create corresponding CSS in `CSS/Courses and Activities/Course X/`
3. Follow the existing course structure and naming conventions
4. Include the standard header navigation and footer
5. Add the `footer.js` script for dynamic copyright year

### File Naming Conventions

- Use descriptive names: `TopicNamecourseX.html`
- No spaces in filenames
- Use camelCase or PascalCase

## Pull Request Process

1. Ensure your code follows the style guide
2. Update documentation if needed
3. Test your changes thoroughly
4. Fill out the PR template completely
5. Request review from maintainers
6. Address any feedback promptly

### PR Checklist

- [ ] Code follows project style guidelines
- [ ] Changes are tested locally
- [ ] Documentation is updated (if applicable)
- [ ] Commit messages are clear and descriptive
- [ ] No merge conflicts with main branch

## Style Guide

### HTML

- Use semantic HTML5 elements
- Include proper meta tags and accessibility attributes
- Maintain consistent indentation (2 spaces)
- Include alt text for images

### CSS

- Use the existing color scheme:
  - Primary: `#174867`
  - Hover: `#286aa7`
  - Background: `#000000`, `#1a2738`
  - Text: `#ffffff`
- Use `em` or `rem` for sizing
- Follow mobile-first responsive design
- Use the Space Grotesk font family

### JavaScript

- Use meaningful variable names
- Add comments for complex logic
- Avoid global variables when possible
- Use `const` and `let` instead of `var`

## Questions?

If you have questions, feel free to:
- Open an issue with the `question` label
- Contact the maintainers

Thank you for contributing to CyberMinds!
