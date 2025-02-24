const mongoose = require("mongoose");
const validator = require("validator");

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
      validate: {
        validator: (value) => ["male", "female", "others"].includes(value),
        message: "Gender must be 'male', 'female', or 'others'.",
      },
    },
    photoURL: {
      type: String,
      default:
        "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcS0rz7SHvHoyn3LwaQ6Zc8LkQEmi-ClP8mvZg&s",
      validate: {
        validator: validator.isURL,
        message: "Invalid photo URL.",
      },
    },
    about: {
      type: String,
      default: "This is the default about section of the user.",
    },
    skills: {
      type: [String],
      validate: {
        validator: (value) => value.length <= 10,
        message: "Skills cannot be more than 10.",
      },
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("User", userSchema);

module.exports = { User };
