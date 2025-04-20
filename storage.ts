import { 
  users, type User, type InsertUser,
  items, type Item, type InsertItem,
  messages, type Message, type InsertMessage
} from "@shared/schema";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { eq, and, like, desc } from 'drizzle-orm';
import createMemoryStore from "memorystore";

export interface IStorage {
  // User methods
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Item methods
  getItem(id: number): Promise<Item | undefined>;
  getItems(options?: { 
    status?: string; 
    type?: string; 
    userId?: number;
    limit?: number;
    offset?: number;
  }): Promise<Item[]>;
  createItem(item: InsertItem): Promise<Item>;
  updateItem(id: number, item: Partial<Item>): Promise<Item | undefined>;
  deleteItem(id: number): Promise<boolean>;
  incrementItemViews(id: number): Promise<void>;
  searchItems(query: string, options?: {
    status?: string;
    type?: string;
    date?: Date;
    location?: string;
  }): Promise<Item[]>;
  
  // Message methods
  getMessage(id: number): Promise<Message | undefined>;
  getMessages(userId: number): Promise<Message[]>;
  getMessagesByItem(itemId: number): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  markMessageAsRead(id: number): Promise<boolean>;
  
  // Session store for authentication
  sessionStore: any;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private items: Map<number, Item>;
  private messages: Map<number, Message>;
  private userIdCounter: number;
  private itemIdCounter: number;
  private messageIdCounter: number;
  public sessionStore: any;

  constructor() {
    this.users = new Map();
    this.items = new Map();
    this.messages = new Map();
    this.userIdCounter = 1;
    this.itemIdCounter = 1;
    this.messageIdCounter = 1;
    
    // Create a memory store for sessions
    const MemoryStore = createMemoryStore(session);
    this.sessionStore = new MemoryStore({
      checkPeriod: 86400000, // 1 day in ms
    });
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.email === email,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.userIdCounter++;
    const createdAt = new Date();
    const user: User = { ...insertUser, id, createdAt };
    this.users.set(id, user);
    return user;
  }

  // Item methods
  async getItem(id: number): Promise<Item | undefined> {
    return this.items.get(id);
  }

  async getItems(options?: { 
    status?: string; 
    type?: string; 
    userId?: number;
    limit?: number;
    offset?: number;
  }): Promise<Item[]> {
    let items = Array.from(this.items.values());
    
    if (options) {
      if (options.status) {
        items = items.filter(item => item.status === options.status);
      }
      if (options.type) {
        items = items.filter(item => item.type === options.type);
      }
      if (options.userId !== undefined) {
        items = items.filter(item => item.userId === options.userId);
      }
      
      // Sort by most recent
      items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      // Apply pagination
      if (options.limit) {
        const offset = options.offset || 0;
        items = items.slice(offset, offset + options.limit);
      }
    }
    
    return items;
  }

  async createItem(insertItem: InsertItem): Promise<Item> {
    const id = this.itemIdCounter++;
    const createdAt = new Date();
    const views = 0;
    
    // Ensure proper typing for images and locationDetails
    const images = insertItem.images || null;
    const locationDetails = insertItem.locationDetails || null;
    
    const item: Item = { 
      ...insertItem, 
      id, 
      createdAt, 
      views,
      images,
      locationDetails
    };
    
    this.items.set(id, item);
    return item;
  }

  async updateItem(id: number, updateData: Partial<Item>): Promise<Item | undefined> {
    const item = await this.getItem(id);
    if (!item) return undefined;
    
    const updatedItem = { ...item, ...updateData };
    this.items.set(id, updatedItem);
    return updatedItem;
  }

  async deleteItem(id: number): Promise<boolean> {
    return this.items.delete(id);
  }

  async incrementItemViews(id: number): Promise<void> {
    const item = await this.getItem(id);
    if (item) {
      item.views += 1;
      this.items.set(id, item);
    }
  }

  async searchItems(query: string, options?: {
    status?: string;
    type?: string;
    date?: Date;
    location?: string;
  }): Promise<Item[]> {
    let items = Array.from(this.items.values());
    
    if (query) {
      const lowerQuery = query.toLowerCase();
      items = items.filter(item => 
        item.name.toLowerCase().includes(lowerQuery) || 
        item.description.toLowerCase().includes(lowerQuery) ||
        item.location.toLowerCase().includes(lowerQuery)
      );
    }
    
    if (options) {
      if (options.status) {
        items = items.filter(item => item.status === options.status);
      }
      if (options.type) {
        items = items.filter(item => item.type === options.type);
      }
      if (options.date) {
        items = items.filter(item => {
          const itemDate = new Date(item.date);
          const searchDate = new Date(options.date!);
          return itemDate.toDateString() === searchDate.toDateString();
        });
      }
      if (options.location) {
        items = items.filter(item => 
          item.location.toLowerCase().includes(options.location!.toLowerCase())
        );
      }
    }
    
    // Sort by most recent
    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    return items;
  }

  // Message methods
  async getMessage(id: number): Promise<Message | undefined> {
    return this.messages.get(id);
  }

  async getMessages(userId: number): Promise<Message[]> {
    return Array.from(this.messages.values()).filter(
      (message) => message.toUserId === userId || message.fromUserId === userId
    ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getMessagesByItem(itemId: number): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter((message) => message.itemId === itemId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const id = this.messageIdCounter++;
    const createdAt = new Date();
    const read = false;
    const message: Message = { ...insertMessage, id, createdAt, read };
    this.messages.set(id, message);
    return message;
  }

  async markMessageAsRead(id: number): Promise<boolean> {
    const message = await this.getMessage(id);
    if (!message) return false;
    
    message.read = true;
    this.messages.set(id, message);
    return true;
  }
}

export const storage = new MemStorage();

// Initialize with sample data for development
async function initDemoData() {
  // Only initialize if no users exist
  if ((await storage.getItems()).length === 0) {
    // Create demo user
    const demoUser = await storage.createUser({
      username: "demouser",
      password: "password",
      email: "demo@example.com",
      name: "Demo User"
    });

    // Create some sample items
    const sampleItems: Omit<InsertItem, "userId">[] = [
      {
        name: "Navy Blue Backpack",
        type: "Personal Items",
        description: "Lost my navy blue backpack with laptop inside near the lake area. Has my initials 'RJ' on the front pocket.",
        status: "lost",
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        location: "India Gate, New Delhi",
        locationDetails: "Near the central lawn area",
        coordinates: { lat: 28.612912, lng: 77.229510 },
        images: ["https://images.unsplash.com/photo-1611916066195-35falce0653e?w=500&q=80"],
        contactName: "Raj Sharma",
        contactEmail: "raj@example.com"
      },
      {
        name: "Car Keys with Red Keychain",
        type: "Personal Items",
        description: "Found these keys at a table in Cafe Coffee Day. Maruti car keys with a distinctive red leather keychain.",
        status: "found",
        date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        location: "MG Road, Bangalore",
        locationDetails: "Outside the mall entrance",
        coordinates: { lat: 12.9716, lng: 77.5946 },
        images: ["https://images.unsplash.com/photo-1628815113969-0895b680d029?w=500&q=80"],
        contactName: "Priya Patel",
        contactEmail: "priya@example.com"
      },
      {
        name: "iPad Pro with Black Case",
        type: "Electronics",
        description: "Left my iPad Pro on the metro around 5:30pm. Has a black leather case and my name on the lock screen.",
        status: "lost",
        date: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5 hours ago
        location: "Rajiv Chowk Metro Station, Delhi",
        locationDetails: "Yellow Line platform",
        coordinates: { lat: 28.6332, lng: 77.2190 },
        images: ["https://images.unsplash.com/photo-1583225214464-9296029427aa?w=500&q=80"],
        contactName: "Amit Kumar",
        contactEmail: "amit@example.com"
      }
    ];

    for (const itemData of sampleItems) {
      await storage.createItem({
        ...itemData,
        userId: demoUser.id
      });
    }
  }
}

// Call this function to initialize the demo data
initDemoData();
