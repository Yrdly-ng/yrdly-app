export interface CreateTicketParams {
  subject: string;
  description: string;
  contactName: string;
  email: string;
  departmentId?: string;
  customFields?: Record<string, any>;
}

export class ZohoService {
  private static cachedAccessToken: string | null = null;
  private static tokenExpiresAt: number = 0;

  private static async getAccessToken(): Promise<string> {
    // If we have a valid token (with 5 min buffer), return it
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
      return this.cachedAccessToken;
    }

    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Missing Zoho OAuth credentials in environment variables');
    }

    const tokenUrl = \`https://accounts.zoho.com/oauth/v2/token?grant_type=refresh_token&client_id=\${clientId}&client_secret=\${clientSecret}&refresh_token=\${refreshToken}\`;

    try {
      const response = await fetch(tokenUrl, { method: 'POST' });
      const data = await response.json();

      if (data.error) {
        throw new Error(\`Zoho auth error: \${data.error}\`);
      }

      this.cachedAccessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
      return data.access_token;
    } catch (error) {
      console.error('Failed to refresh Zoho access token:', error);
      throw new Error('Failed to authenticate with Zoho Desk');
    }
  }

  /**
   * Search for an existing contact by email, or create a new one.
   * Returns the contact ID.
   */
  private static async getOrCreateContact(email: string, lastName: string, accessToken: string): Promise<string> {
    const orgId = process.env.ZOHO_ORG_ID;
    
    // 1. Search for contact
    const searchUrl = \`https://desk.zoho.com/api/v1/contacts/search?email=\${encodeURIComponent(email)}\`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'Authorization': \`Zoho-oauthtoken \${accessToken}\`,
        'orgId': orgId || ''
      }
    });

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.data && searchData.data.length > 0) {
        return searchData.data[0].id;
      }
    }

    // 2. Create contact if not found
    const createUrl = 'https://desk.zoho.com/api/v1/contacts';
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: {
        'Authorization': \`Zoho-oauthtoken \${accessToken}\`,
        'orgId': orgId || '',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        lastName: lastName || 'User',
        email: email
      })
    });

    if (!createRes.ok) {
      const errorText = await createRes.text();
      throw new Error(\`Failed to create Zoho contact: \${errorText}\`);
    }

    const createData = await createRes.json();
    return createData.id;
  }

  /**
   * Create a new ticket in Zoho Desk
   */
  static async createTicket(params: CreateTicketParams): Promise<string> {
    try {
      const accessToken = await this.getAccessToken();
      const orgId = process.env.ZOHO_ORG_ID;

      // Ensure we have the user as a contact
      const contactId = await this.getOrCreateContact(params.email, params.contactName, accessToken);

      const ticketPayload = {
        subject: params.subject,
        description: params.description,
        contactId: contactId,
        departmentId: params.departmentId, // Optional, defaults to primary department
        channel: 'Web',
        cf: params.customFields
      };

      const ticketUrl = 'https://desk.zoho.com/api/v1/tickets';
      const ticketRes = await fetch(ticketUrl, {
        method: 'POST',
        headers: {
          'Authorization': \`Zoho-oauthtoken \${accessToken}\`,
          'orgId': orgId || '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(ticketPayload)
      });

      if (!ticketRes.ok) {
        const errorText = await ticketRes.text();
        throw new Error(\`Failed to create ticket: \${errorText}\`);
      }

      const ticketData = await ticketRes.json();
      return ticketData.ticketNumber; // or ticketData.id depending on what you want to store

    } catch (error) {
      console.error('Zoho createTicket error:', error);
      throw error;
    }
  }

  /**
   * Close a ticket automatically when resolved in Yrdly
   */
  static async closeTicket(ticketId: string): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      const orgId = process.env.ZOHO_ORG_ID;

      const ticketUrl = \`https://desk.zoho.com/api/v1/tickets/\${ticketId}\`;
      const ticketRes = await fetch(ticketUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': \`Zoho-oauthtoken \${accessToken}\`,
          'orgId': orgId || '',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: 'Closed'
        })
      });

      if (!ticketRes.ok) {
        const errorText = await ticketRes.text();
        console.error(\`Failed to close Zoho ticket \${ticketId}: \${errorText}\`);
      }
    } catch (error) {
      console.error('Zoho closeTicket error:', error);
    }
  }
}
