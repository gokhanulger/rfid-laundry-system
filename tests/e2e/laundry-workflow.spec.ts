import { test, expect, Page } from '@playwright/test';

const API_BASE = 'http://localhost:3001/api';

// Test user credentials (from seed.ts)
const TEST_USER = {
  email: 'admin@laundry.com',
  password: 'admin123',
};

// Helper function to login
async function login(page: Page) {
  await page.goto('/login');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', TEST_USER.email);
  await page.fill('input[type="password"]', TEST_USER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard)?$/);
}

// Helper to make API calls
async function apiCall(page: Page, method: string, endpoint: string, body?: any) {
  return page.evaluate(async ({ method, endpoint, body, apiBase }) => {
    const res = await fetch(`${apiBase}${endpoint}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  }, { method, endpoint, body, apiBase: API_BASE });
}

test.describe('Authentication', () => {
  test('should display login page', async ({ page }) => {
    await page.goto('/login');
    // Page shows "RFID Laundry Tracking" and "Sign in to your account"
    await expect(page.locator('h2')).toContainText('RFID Laundry Tracking');
    await expect(page.locator('text=Sign in')).toBeVisible();
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    await login(page);
    // Should redirect to dashboard after login
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'wrong@test.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');
    // Should show error message in red div
    await expect(page.locator('.text-red-700, .bg-red-50')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should navigate to Dashboard', async ({ page }) => {
    await page.click('text=/dashboard|ana sayfa|pano/i');
    await expect(page).toHaveURL(/\/dashboard|\/$/);
  });

  test('should navigate to Items page', async ({ page }) => {
    const itemsLink = page.locator('a[href*="items"], text=/items|urunler|tekstil/i').first();
    if (await itemsLink.isVisible()) {
      await itemsLink.click();
      await expect(page).toHaveURL(/items/);
    }
  });

  test('should navigate to Pickups page', async ({ page }) => {
    const pickupsLink = page.locator('a[href*="pickup"], text=/pickup|toplama/i').first();
    if (await pickupsLink.isVisible()) {
      await pickupsLink.click();
      await expect(page).toHaveURL(/pickup/);
    }
  });
});

test.describe('Step 1: Driver Pickup Dirty Items from Hotel', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display DirtyPickup page with form', async ({ page }) => {
    await page.goto('/dirty-pickup');
    await page.waitForLoadState('networkidle');

    // Check page title/heading
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible();

    // Check for essential form elements
    const bagCodeInput = page.locator('input[placeholder*="bag" i], input[name*="bag" i], label:has-text("bag") + input').first();
    const sealInput = page.locator('input[placeholder*="seal" i], input[name*="seal" i], label:has-text("seal") + input').first();

    expect(await bagCodeInput.isVisible() || await sealInput.isVisible()).toBeTruthy();
  });

  test('should have Scan Items button', async ({ page }) => {
    await page.goto('/dirty-pickup');
    await page.waitForLoadState('networkidle');

    const scanButton = page.locator('button:has-text("scan"), button:has-text("tara")').first();
    await expect(scanButton).toBeVisible();
  });

  test('should have Create Pickup button', async ({ page }) => {
    await page.goto('/dirty-pickup');
    await page.waitForLoadState('networkidle');

    const createButton = page.locator('button:has-text("create"), button:has-text("olustur"), button:has-text("pickup")').first();
    await expect(createButton).toBeVisible();
  });
});

test.describe('Step 2: Receive Dirty Items at Laundry', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display ReceiveDirty page', async ({ page }) => {
    await page.goto('/receive-dirty');
    await page.waitForLoadState('networkidle');

    // Check page loads correctly
    const heading = page.locator('h1').first();
    await expect(heading).toContainText(/receive|kirli|teslim/i);
  });

  test('should show pending pickups list', async ({ page }) => {
    await page.goto('/receive-dirty');
    await page.waitForLoadState('networkidle');

    // Either shows pickup cards or "no pending" message
    const hasContent = await page.locator('.bg-white.rounded-lg, text=/no pending|beklenen yok/i').first().isVisible();
    expect(hasContent).toBeTruthy();
  });

  test('should have search functionality', async ({ page }) => {
    await page.goto('/receive-dirty');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="search" i], input[placeholder*="ara" i]').first();
    await expect(searchInput).toBeVisible();
  });

  test('should have Receive button on pickup cards', async ({ page }) => {
    await page.goto('/receive-dirty');
    await page.waitForLoadState('networkidle');

    // Check for receive button if there are pickups
    const receiveBtn = page.locator('button:has-text("receive"), button:has-text("teslim al")').first();
    const noPending = page.locator('text=/no pending|beklenen yok/i').first();

    expect(await receiveBtn.isVisible() || await noPending.isVisible()).toBeTruthy();
  });
});

test.describe('Step 3: Laundry Processing - Mark Items Clean', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display LaundryProcessing page', async ({ page }) => {
    await page.goto('/laundry-processing');
    await page.waitForLoadState('networkidle');

    const heading = page.locator('h1').first();
    await expect(heading).toContainText(/processing|isleme|camasir/i);
  });

  test('should show dirty items statistics', async ({ page }) => {
    await page.goto('/laundry-processing');
    await page.waitForLoadState('networkidle');

    // Stats cards should be visible
    const statsCards = page.locator('.bg-white.rounded-lg.shadow');
    expect(await statsCards.count()).toBeGreaterThanOrEqual(1);
  });

  test('should have Select All button', async ({ page }) => {
    await page.goto('/laundry-processing');
    await page.waitForLoadState('networkidle');

    // Either Select All button or empty state
    const selectAllBtn = page.locator('button:has-text("select all"), button:has-text("tumunu sec")').first();
    const emptyState = page.locator('text=/no dirty items|kirli urun yok/i').first();

    expect(await selectAllBtn.isVisible() || await emptyState.isVisible()).toBeTruthy();
  });

  test('should have Mark Clean button', async ({ page }) => {
    await page.goto('/laundry-processing');
    await page.waitForLoadState('networkidle');

    const markCleanBtn = page.locator('button:has-text("mark"), button:has-text("temiz")').first();
    await expect(markCleanBtn).toBeVisible();
  });

  test('should have Refresh button', async ({ page }) => {
    await page.goto('/laundry-processing');
    await page.waitForLoadState('networkidle');

    const refreshBtn = page.locator('button:has-text("refresh"), button:has-text("yenile")').first();
    await expect(refreshBtn).toBeVisible();
  });
});

test.describe('Step 4: Ironer - Print Labels', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display Ironer Interface page', async ({ page }) => {
    await page.goto('/ironer');
    await page.waitForLoadState('networkidle');

    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible();
  });

  test('should have delivery creation functionality', async ({ page }) => {
    await page.goto('/ironer');
    await page.waitForLoadState('networkidle');

    // Check for hotel/tenant selector or delivery controls
    const hotelSelect = page.locator('select, [role="combobox"]').first();
    const createDeliveryBtn = page.locator('button:has-text("create"), button:has-text("olustur"), button:has-text("delivery")').first();

    expect(await hotelSelect.isVisible() || await createDeliveryBtn.isVisible()).toBeTruthy();
  });

  test('should have Print Label button', async ({ page }) => {
    await page.goto('/ironer');
    await page.waitForLoadState('networkidle');

    const printBtn = page.locator('button:has-text("print"), button:has-text("yazdir"), button:has-text("label"), button:has-text("etiket")').first();
    await expect(printBtn).toBeVisible();
  });
});

test.describe('Step 5: Packaging', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display Packaging page', async ({ page }) => {
    await page.goto('/packaging');
    await page.waitForLoadState('networkidle');

    const heading = page.locator('h1').first();
    await expect(heading).toContainText(/packaging|paketleme/i);
  });

  test('should have barcode scanner input', async ({ page }) => {
    await page.goto('/packaging');
    await page.waitForLoadState('networkidle');

    const barcodeInput = page.locator('input[placeholder*="scan" i], input[placeholder*="barcode" i], input[placeholder*="tara" i]').first();
    await expect(barcodeInput).toBeVisible();
  });

  test('should show deliveries ready for packaging', async ({ page }) => {
    await page.goto('/packaging');
    await page.waitForLoadState('networkidle');

    // Either delivery cards or empty state
    const deliveryCard = page.locator('.bg-white.rounded-lg, text=/no deliveries|teslimat yok/i').first();
    await expect(deliveryCard).toBeVisible();
  });

  test('should have Package button', async ({ page }) => {
    await page.goto('/packaging');
    await page.waitForLoadState('networkidle');

    const packageBtn = page.locator('button:has-text("package"), button:has-text("paketle")').first();
    const emptyState = page.locator('text=/no deliveries|teslimat yok/i').first();

    expect(await packageBtn.isVisible() || await emptyState.isVisible()).toBeTruthy();
  });
});

test.describe('Step 6 & 7: Driver Activities - Pickup & Deliver', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display Driver Activities page', async ({ page }) => {
    await page.goto('/driver-activities');
    await page.waitForLoadState('networkidle');

    const heading = page.locator('h1').first();
    await expect(heading).toContainText(/driver|surucu/i);
  });

  test('should have Pickup and Deliver tabs', async ({ page }) => {
    await page.goto('/driver-activities');
    await page.waitForLoadState('networkidle');

    const pickupTab = page.locator('button:has-text("pickup"), button:has-text("toplama")').first();
    const deliverTab = page.locator('button:has-text("deliver"), button:has-text("teslim")').first();

    await expect(pickupTab).toBeVisible();
    await expect(deliverTab).toBeVisible();
  });

  test('should have barcode scanner for deliveries', async ({ page }) => {
    await page.goto('/driver-activities');
    await page.waitForLoadState('networkidle');

    const barcodeInput = page.locator('input[placeholder*="scan" i], input[placeholder*="barcode" i], input[placeholder*="tara" i]').first();
    await expect(barcodeInput).toBeVisible();
  });

  test('should show statistics for ready/in-transit deliveries', async ({ page }) => {
    await page.goto('/driver-activities');
    await page.waitForLoadState('networkidle');

    // Stats cards should show counts
    const statsSection = page.locator('.grid.grid-cols-3, .grid.grid-cols-2');
    await expect(statsSection.first()).toBeVisible();
  });

  test('should switch between Pickup and Deliver tabs', async ({ page }) => {
    await page.goto('/driver-activities');
    await page.waitForLoadState('networkidle');

    const pickupTab = page.locator('button:has-text("pickup"), button:has-text("toplama")').first();
    const deliverTab = page.locator('button:has-text("deliver"), button:has-text("teslim")').first();

    // Click Deliver tab
    await deliverTab.click();
    await expect(deliverTab).toHaveClass(/bg-cyan|active|selected/);

    // Click Pickup tab
    await pickupTab.click();
    await expect(pickupTab).toHaveClass(/bg-cyan|active|selected/);
  });
});

test.describe('Items Management', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display Items page with list', async ({ page }) => {
    await page.goto('/items');
    await page.waitForLoadState('networkidle');

    const heading = page.locator('h1').first();
    await expect(heading).toContainText(/item|urun|tekstil/i);
  });

  test('should have Create Item button', async ({ page }) => {
    await page.goto('/items');
    await page.waitForLoadState('networkidle');

    const createBtn = page.locator('button:has-text("create"), button:has-text("add"), button:has-text("ekle"), button:has-text("yeni")').first();
    await expect(createBtn).toBeVisible();
  });

  test('should have pagination controls', async ({ page }) => {
    await page.goto('/items');
    await page.waitForLoadState('networkidle');

    // Either pagination or items count indicator
    const pagination = page.locator('button:has-text("next"), button:has-text("prev"), text=/page|sayfa|of|toplam/i').first();
    const itemsDisplay = page.locator('text=/showing|gosterilen/i, text=/item|urun/i').first();

    expect(await pagination.isVisible() || await itemsDisplay.isVisible()).toBeTruthy();
  });
});

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should display dashboard with statistics', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Dashboard should have stats cards
    const statsCards = page.locator('.bg-white.rounded-lg, .bg-white.shadow');
    expect(await statsCards.count()).toBeGreaterThanOrEqual(1);
  });

  test('should show item status distribution', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Look for status-related content
    const statusContent = page.locator('text=/at_hotel|at_laundry|processing|ready|in_transit|delivered|status/i').first();
    expect(await statusContent.isVisible()).toBeTruthy();
  });
});

test.describe('UI Components', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('sidebar navigation should work', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const sidebar = page.locator('nav, aside, .sidebar').first();
    await expect(sidebar).toBeVisible();
  });

  test('should have user profile/logout option', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Look for user menu or logout button
    const userMenu = page.locator('button:has-text("logout"), button:has-text("cikis"), [aria-label*="user"], [aria-label*="profile"]').first();
    const avatar = page.locator('img[alt*="avatar"], .avatar, [class*="avatar"]').first();

    expect(await userMenu.isVisible() || await avatar.isVisible()).toBeTruthy();
  });
});

test.describe('Responsive Design', () => {
  test('should work on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await login(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Page should still be functional
    const mainContent = page.locator('main, .main-content, [role="main"]').first();
    await expect(mainContent).toBeVisible();
  });

  test('should work on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await login(page);
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    const mainContent = page.locator('main, .main-content, [role="main"]').first();
    await expect(mainContent).toBeVisible();
  });
});
