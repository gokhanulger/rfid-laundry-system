# Login Information

## Default Test Users

After running the seed script, you can use these credentials to log in:

### System Admin
- **Email:** `admin@laundry.com`
- **Password:** `admin123`
- **Role:** Full system access, can manage all tenants and users

### Laundry Manager
- **Email:** `manager@laundry.com`
- **Password:** `manager123`
- **Role:** Oversees laundry operations

### Hotel Owner
- **Email:** `owner@hotel.com`
- **Password:** `owner123`
- **Role:** Monitors hotel items and receives reports

### Operator
- **Email:** `operator@laundry.com`
- **Password:** `operator123`
- **Role:** Day-to-day laundry operations

### Ironer (Utu Etiketi)
- **Email:** `ironer@laundry.com`
- **Password:** `ironer123`
- **Role:** Iron station label printing only

### Packager (Paketleme)
- **Email:** `packager@laundry.com`
- **Password:** `packager123`
- **Role:** Packaging station only

### Auditor (Irsaliye)
- **Email:** `auditor@laundry.com`
- **Password:** `auditor123`
- **Role:** Waybill/Irsaliye station only

## How to Create Users

### Option 1: Run Seed Script (Recommended for Testing)

```bash
cd backend
npm run db:seed
```

This will create all the test users listed above.

### Option 2: Register via API

You can create new users by calling the registration endpoint:

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "password123",
    "firstName": "John",
    "lastName": "Doe",
    "role": "operator",
    "tenantId": null
  }'
```

### Option 3: Manual Database Insert

You can manually insert users into the database using SQL or a database client.

## Login URL

Once the frontend is running, go to:
**http://localhost:3000/login**

## Important Notes

⚠️ **Security Warning:** The default passwords are for development/testing only. Change them immediately in production!

## Available Roles

- `system_admin` - Full system access
- `laundry_manager` - Laundry operations management
- `operator` - Day-to-day operations
- `driver` - Pickup and delivery
- `ironer` - Utu Etiketi (Iron station) only
- `packager` - Paketleme (Packaging station) only
- `auditor` - Irsaliye (Waybill station) only
- `hotel_owner` - Hotel-specific access

