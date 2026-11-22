/**
 * Vishnu Shankar Tripathi - Portfolio Scripts
 * Phase 1: Theme Switcher & Responsive Floating Glass Navigation
 */

(function () {
  'use strict';

  // --- Theme Management ---
  const THEME_STORAGE_KEY = 'theme';
  const themeToggleBtn = document.getElementById('theme-toggle');
  const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');

  /**
   * Determine the current active theme
   * Priority: localStorage > system preference > default 'light'
   */
  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
    return prefersDarkScheme.matches ? 'dark' : 'light';
  }

  /**
   * Apply theme to root and update toggle button state
   */
  function applyTheme(theme, persist = false) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (themeToggleBtn) {
        themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun" aria-hidden="true"></i>';
        themeToggleBtn.setAttribute('aria-label', 'Switch to light theme');
        themeToggleBtn.setAttribute('title', 'Switch to light theme');
      }
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (themeToggleBtn) {
        themeToggleBtn.innerHTML = '<i class="fa-solid fa-moon" aria-hidden="true"></i>';
        themeToggleBtn.setAttribute('aria-label', 'Switch to dark theme');
        themeToggleBtn.setAttribute('title', 'Switch to dark theme');
      }
    }

    if (persist) {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }

  // Initialize theme on script load
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme, false);

  // Toggle button event
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', function () {
      const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      applyTheme(newTheme, true);
    });
  }

  // React to OS preference changes if user has not manually set a preference
  prefersDarkScheme.addEventListener('change', function (e) {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (!saved) {
      applyTheme(e.matches ? 'dark' : 'light', false);
    }
  });

  // --- Responsive Navigation & Mobile Drawer ---
  const mainNav = document.getElementById('main-nav');
  const mobileToggle = document.getElementById('mobile-toggle');
  const mobileDrawer = document.getElementById('mobile-drawer');
  const navLinks = document.querySelectorAll('.nav-link, .mobile-nav-link');

  function closeMobileMenu() {
    if (mobileDrawer && mobileDrawer.classList.contains('open')) {
      mobileDrawer.classList.remove('open');
      mobileDrawer.setAttribute('aria-hidden', 'true');
      if (mainNav) mainNav.classList.remove('menu-open');
      if (mobileToggle) {
        mobileToggle.setAttribute('aria-expanded', 'false');
        mobileToggle.innerHTML = '<i class="fa-solid fa-bars" aria-hidden="true"></i>';
      }
    }
  }

  function toggleMobileMenu() {
    if (!mobileDrawer) return;
    const isOpen = mobileDrawer.classList.contains('open');
    if (isOpen) {
      closeMobileMenu();
    } else {
      mobileDrawer.classList.add('open');
      mobileDrawer.setAttribute('aria-hidden', 'false');
      if (mainNav) mainNav.classList.add('menu-open');
      if (mobileToggle) {
        mobileToggle.setAttribute('aria-expanded', 'true');
        mobileToggle.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
      }
    }
  }

  if (mobileToggle) {
    mobileToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMobileMenu();
    });
  }

  // Close mobile drawer when clicking any link
  navLinks.forEach(function (link) {
    link.addEventListener('click', function () {
      closeMobileMenu();
    });
  });

  // Close mobile drawer when clicking outside
  document.addEventListener('click', function (e) {
    if (mainNav && !mainNav.contains(e.target)) {
      closeMobileMenu();
    }
  });

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeMobileMenu();
    }
  });

  // --- ScrollSpy: Active Section Indicator ---
  const sections = document.querySelectorAll('header, section[id]');

  function onScroll() {
    const scrollPos = window.scrollY + 140;

    let currentSectionId = '';
    sections.forEach(function (section) {
      const top = section.offsetTop;
      const height = section.offsetHeight;
      if (scrollPos >= top && scrollPos < top + height) {
        currentSectionId = section.getAttribute('id') || '';
      }
    });

    navLinks.forEach(function (link) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('#')) {
        const targetId = href.substring(1);
        if (targetId === currentSectionId && currentSectionId !== '') {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      }
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
