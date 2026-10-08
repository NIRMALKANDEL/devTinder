const validator = require("validator");

const validateSignUpData = (req) => {
  const { firstName, lastName, emailId, password, confirmPassword } = req.body;

  if (!firstName || !lastName) {
    throw new Error("Name doesn't exist");
  }

  if (!emailId || !validator.isEmail(emailId)) {
    throw new Error("Invalid email address");
  }

  validatePasswordData(password, confirmPassword);
};

// Added: shared by signup and reset password
const validatePasswordData = (password, confirmPassword) => {
  if (!password || !validator.isStrongPassword(password)) {
    throw new Error(
      "Password must be at least 8 characters, include 1 uppercase letter, 1 number, and 1 special character."
    );
  }

  if (password !== confirmPassword) {
    throw new Error("Passwords do not match");
  }
};

const validateEditProfileData = (req) => {
  const allowedEditFields = [
    "firstName",
    "lastName",
    "emailId",
    "photoURL",
    "gender",
    "about",
    "age",
    "skills",
    "portfolioUrl", // Added: allow editing the portfolio website URL
  ];
  const isEditAllowed = Object.keys(req.body).every((field) =>
    allowedEditFields.includes(field)
  );
  return isEditAllowed;
};

module.exports = {
  validateSignUpData,
  validateEditProfileData,
  validatePasswordData,
};
