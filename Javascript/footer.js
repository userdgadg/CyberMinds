// Dynamic copyright year for CyberMinds
// This script automatically updates the copyright year in all footers

document.addEventListener('DOMContentLoaded', function() {
  const currentYear = new Date().getFullYear();
  
  // Find all elements with class 'copyright-year' and update them
  const yearSpans = document.querySelectorAll('.copyright-year');
  yearSpans.forEach(span => {
    span.textContent = currentYear;
  });
  
  // Also update any footer paragraphs that contain the copyright text
  const footerParagraphs = document.querySelectorAll('footer p, .page-footer p');
  footerParagraphs.forEach(p => {
    if (p.textContent.includes('CyberMinds')) {
      p.innerHTML = `&copy; <span class="copyright-year">${currentYear}</span> CyberMinds, Inc. All rights reserved.`;
    }
  });
});
