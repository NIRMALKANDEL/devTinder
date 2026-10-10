const mongoose = require("mongoose");
const validator = require("validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (value) => value.length >= 4 && value.length <= 50,
        message: "First name must be between 4 and 50 characters.",
      },
    },
    lastName: {
      type: String,
      trim: true,
      validate: {
        validator: (value) => value.length === 0 || value.length >= 2,
        message: "Last name must be at least 2 characters if provided.",
      },
    },
    emailId: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      validate: {
        validator: validator.isEmail,
        message: "Invalid email address.",
      },
    },
    password: {
      type: String,
      required: true,
      validate: {
        validator: (value) =>
          validator.isStrongPassword(value, {
            minLength: 8,
            minLowercase: 1,
            minUppercase: 1,
            minNumbers: 1,
            minSymbols: 1,
          }),
        message:
          "Password must be at least 8 characters, include 1 uppercase letter, 1 number, and 1 special character.",
      },
    },
    age: { type: Number, min: 18 },
    gender: {
      type: String,
      enum: {
        values: ["male", "female", "others"],
        message: `{VALUE}Gender must be 'male', 'female', or 'others'`,
      },
    },
    photoURL: {
      type: String,
      default:
        "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS0rz7SHvHoyn3LwaQ6Zc8LkQEmi-ClP8mvZg&s",
      // Changed: optional; either an image address or a photo uploaded from the
      // device (stored as a small base64 image, max ~700 KB)
      validate: {
        validator: (value) =>
          value === "" ||
          validator.isURL(value) ||
          (value.length <= 1000000 &&
            /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)),
        message: "Photo must be an image address or an uploaded JPG, PNG, WEBP or GIF under 700 KB.",
      },
    },
    about: {
      type: String,
      default: "This is the default about section of the user.",
    },
    skills: {
      type: [String],
      // Changed: enforce the Top 5 Skills limit at the schema level
      validate: {
        validator: (value) => value.length <= 5,
        message: "Skills cannot be more than 5.",
      },
    },
    // Added: optional portfolio website URL
    portfolioUrl: {
      type: String,
      trim: true,
      default: "",
      validate: {
        validator: (value) => value === "" || validator.isURL(value),
        message: "Invalid portfolio URL.",
      },
    },
    // Added: optional GitHub profile URL (must point to github.com)
    githubUrl: {
      type: String,
      trim: true,
      default: "",
      validate: {
        validator: (value) =>
          value === "" ||
          (validator.isURL(value) && /(^|\/\/|\.)github\.com(\/|$)/i.test(value)),
        message: "Invalid GitHub URL. Use a github.com link.",
      },
    },
    // Added: email verification. Users created before this feature have no
    // value here and are treated as verified.
    isEmailVerified: { type: Boolean },
    emailVerificationToken: { type: String, select: false },
    // Added: forgot / reset password
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
    // Added: users this user has blocked (hidden from feed, requests and chat both ways)
    blockedUsers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
      index: true,
    },
    // Added: sessions (JWTs) issued before this date are rejected
    passwordChangedAt: { type: Date, select: false },
  },
  {
    timestamps: true,
    // Fixed: never send the password hash or auth tokens to the client.
    // /login, /profile/view and /profile/edit return the user document directly,
    // so this strips the secrets from every JSON response in one place.
    toJSON: {
      transform: (doc, ret) => {
        delete ret.password;
        delete ret.emailVerificationToken;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.passwordChangedAt;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.methods.getJWT = async function () {
  const user = this;
  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "1d",
  });
  return token;
};

userSchema.methods.validatePassword = async function (passwordInputByUser) {
  const user = this;
  const passwordHash = user.password;

  const isPasswordValid = await bcrypt.compare(
    passwordInputByUser,
    passwordHash
  );
  return isPasswordValid;
};

const User = mongoose.model("User", userSchema);
module.exports = { User };
