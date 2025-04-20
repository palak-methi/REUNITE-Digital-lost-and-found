import type { Request, Response, NextFunction } from "express";
import express, { type Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertItemSchema, itemFormSchema, insertUserSchema, insertMessageSchema } from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { setupAuth } from "./auth";

// Setup multer for file uploads
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage_multer = multer.diskStorage({
  destination: function (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) {
    cb(null, uploadDir);
  },
  filename: function (req: Express.Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) {
    const uniqueSuffix = `${Date.now()}-${nanoid(6)}`;
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({ 
  storage: storage_multer,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    // Only accept images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication
  setupAuth(app);
  
  // Create HTTP server
  const httpServer = createServer(app);

  // Middleware to handle errors
  const handleError = (err: any, res: Response) => {
    console.error("Error:", err);
    
    if (err instanceof ZodError) {
      const validationError = fromZodError(err);
      return res.status(400).json({ message: validationError.message });
    }
    
    const status = err.status || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
  };

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Item routes
  app.get("/api/items", async (req, res) => {
    try {
      const { status, type, limit = 10, offset = 0 } = req.query;
      
      const options: any = {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      };
      
      if (status) options.status = status;
      if (type) options.type = type;
      
      const items = await storage.getItems(options);
      res.json(items);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.get("/api/items/search", async (req, res) => {
    try {
      const { q, status, type, date, location } = req.query;
      
      const items = await storage.searchItems(q as string, {
        status: status as string,
        type: type as string,
        date: date ? new Date(date as string) : undefined,
        location: location as string
      });
      
      res.json(items);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.get("/api/items/:id", async (req, res) => {
    try {
      const item = await storage.getItem(parseInt(req.params.id));
      
      if (!item) {
        return res.status(404).json({ message: "Item not found" });
      }
      
      // Increment view count
      await storage.incrementItemViews(item.id);
      
      // Return updated item
      const updatedItem = await storage.getItem(parseInt(req.params.id));
      res.json(updatedItem);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post("/api/items", upload.array("images", 3), async (req, res) => {
    try {
      // Get image paths from uploaded files
      const files = req.files as Express.Multer.File[];
      const imagePaths = files.map(file => `/uploads/${file.filename}`);
      
      // Parse and validate item data
      const itemData = {
        ...req.body,
        images: imagePaths,
        // Parse userId to make sure it's a number
        userId: req.body.userId ? parseInt(req.body.userId) : undefined
      };
      
      // If coordinates are provided as strings, parse them
      if (req.body.lat && req.body.lng) {
        itemData.coordinates = {
          lat: parseFloat(req.body.lat),
          lng: parseFloat(req.body.lng)
        };
      }
      
      const validatedData = itemFormSchema.parse(itemData);
      const item = await storage.createItem(validatedData);
      
      res.status(201).json(item);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.patch("/api/items/:id", upload.array("images", 3), async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      const existingItem = await storage.getItem(itemId);
      
      if (!existingItem) {
        return res.status(404).json({ message: "Item not found" });
      }
      
      // Get image paths from uploaded files
      const files = req.files as Express.Multer.File[];
      let imagePaths = existingItem.images || [];
      
      if (files.length > 0) {
        const newImagePaths = files.map(file => `/uploads/${file.filename}`);
        imagePaths = [...imagePaths, ...newImagePaths];
      }
      
      // Update item data
      const updateData = {
        ...req.body,
        images: imagePaths,
        // Parse userId to make sure it's a number
        userId: req.body.userId ? parseInt(req.body.userId) : undefined
      };
      
      // If coordinates are provided as strings, parse them
      if (req.body.lat && req.body.lng) {
        updateData.coordinates = {
          lat: parseFloat(req.body.lat),
          lng: parseFloat(req.body.lng)
        };
      }
      
      // Validate and update
      const updatedItem = await storage.updateItem(itemId, updateData);
      res.json(updatedItem);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.delete("/api/items/:id", async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      const success = await storage.deleteItem(itemId);
      
      if (!success) {
        return res.status(404).json({ message: "Item not found" });
      }
      
      res.status(204).end();
    } catch (err) {
      handleError(err, res);
    }
  });

  // User routes
  app.post("/api/users", async (req, res) => {
    try {
      const userData = insertUserSchema.parse(req.body);
      
      // Check if user already exists
      const existingUser = await storage.getUserByEmail(userData.email);
      if (existingUser) {
        return res.status(409).json({ message: "User with this email already exists" });
      }
      
      const user = await storage.createUser(userData);
      
      // Don't return the password
      const { password, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (err) {
      handleError(err, res);
    }
  });

  // Message routes
  app.get("/api/messages", async (req, res) => {
    try {
      const userId = parseInt(req.query.userId as string);
      
      if (!userId) {
        return res.status(400).json({ message: "userId query parameter is required" });
      }
      
      const messages = await storage.getMessages(userId);
      res.json(messages);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.get("/api/items/:itemId/messages", async (req, res) => {
    try {
      const itemId = parseInt(req.params.itemId);
      const messages = await storage.getMessagesByItem(itemId);
      res.json(messages);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.post("/api/messages", async (req, res) => {
    try {
      const messageData = insertMessageSchema.parse(req.body);
      const message = await storage.createMessage(messageData);
      res.status(201).json(message);
    } catch (err) {
      handleError(err, res);
    }
  });

  app.patch("/api/messages/:id/read", async (req, res) => {
    try {
      const messageId = parseInt(req.params.id);
      const success = await storage.markMessageAsRead(messageId);
      
      if (!success) {
        return res.status(404).json({ message: "Message not found" });
      }
      
      res.status(204).end();
    } catch (err) {
      handleError(err, res);
    }
  });

  // Serve uploaded files
  app.use("/uploads", express.static(uploadDir));

  return httpServer;
}
