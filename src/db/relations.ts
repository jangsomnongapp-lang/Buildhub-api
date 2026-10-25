import { relations } from "drizzle-orm/relations";
import { profiles, applications, listings, supplierCatalogItems, catalogStockNotifications, supplierStores, usersInAuth, deviceTokens, postComments, commentLikes, listingPhotos, catalogStockReports, messageThreads, posts, portfolioPhotos, materialRequests, materialRequestPhotos, notifications, projects, postPhotos, materialRequestResponses, lotteryTickets, lotteryDraws, messages, passwordResetCodes, projectMessages, projectLogs, projectRatings, stories, storyViews, rentalListings, rentalLikes, rentalPhotos, rentalComments, prizeClaims, supplierCategories, supplierStoreCategories, catalogProducts, categories, userCategories, superUserIdentities, supplierStorePhotos, blogCategories, blogPosts, catalogItemEvents, listingCategories, rentalCommentLikes, postLikes, storeFollowers, marketplaceItems, marketplaceItemPhotos } from "./schema";

export const applicationsRelations = relations(applications, ({one}) => ({
	profile: one(profiles, {
		fields: [applications.applicantId],
		references: [profiles.id]
	}),
	listing: one(listings, {
		fields: [applications.listingId],
		references: [listings.id]
	}),
}));

export const profilesRelations = relations(profiles, ({one, many}) => ({
	applications: many(applications),
	messageThreads_participantA: many(messageThreads, {
		relationName: "messageThreads_participantA_profiles_id"
	}),
	messageThreads_participantB: many(messageThreads, {
		relationName: "messageThreads_participantB_profiles_id"
	}),
	portfolioPhotos: many(portfolioPhotos),
	postComments: many(postComments),
	notifications_relatedUserId: many(notifications, {
		relationName: "notifications_relatedUserId_profiles_id"
	}),
	notifications_userId: many(notifications, {
		relationName: "notifications_userId_profiles_id"
	}),
	posts: many(posts),
	listings: many(listings),
	messages: many(messages),
	storyViews: many(storyViews),
	rentalComments: many(rentalComments),
	rentalListings: many(rentalListings),
	stories: many(stories),
	usersInAuth: one(usersInAuth, {
		fields: [profiles.id],
		references: [usersInAuth.id]
	}),
	profile: one(profiles, {
		fields: [profiles.masterAccountId],
		references: [profiles.id],
		relationName: "profiles_masterAccountId_profiles_id"
	}),
	profiles: many(profiles, {
		relationName: "profiles_masterAccountId_profiles_id"
	}),
	userCategories: many(userCategories),
	superUserIdentities_identityUserId: many(superUserIdentities, {
		relationName: "superUserIdentities_identityUserId_profiles_id"
	}),
	superUserIdentities_masterUserId: many(superUserIdentities, {
		relationName: "superUserIdentities_masterUserId_profiles_id"
	}),
	marketplaceItems: many(marketplaceItems),
}));

export const listingsRelations = relations(listings, ({one, many}) => ({
	applications: many(applications),
	listingPhotos: many(listingPhotos),
	notifications: many(notifications),
	profile: one(profiles, {
		fields: [listings.userId],
		references: [profiles.id]
	}),
	listingCategories: many(listingCategories),
}));

export const catalogStockNotificationsRelations = relations(catalogStockNotifications, ({one}) => ({
	supplierCatalogItem: one(supplierCatalogItems, {
		fields: [catalogStockNotifications.itemId],
		references: [supplierCatalogItems.id]
	}),
	supplierStore: one(supplierStores, {
		fields: [catalogStockNotifications.storeId],
		references: [supplierStores.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [catalogStockNotifications.userId],
		references: [usersInAuth.id]
	}),
}));

export const supplierCatalogItemsRelations = relations(supplierCatalogItems, ({one, many}) => ({
	catalogStockNotifications: many(catalogStockNotifications),
	catalogStockReports: many(catalogStockReports),
	supplierCategory: one(supplierCategories, {
		fields: [supplierCatalogItems.categoryId],
		references: [supplierCategories.id]
	}),
	catalogProduct: one(catalogProducts, {
		fields: [supplierCatalogItems.productId],
		references: [catalogProducts.id]
	}),
	supplierStore: one(supplierStores, {
		fields: [supplierCatalogItems.storeId],
		references: [supplierStores.id]
	}),
	catalogItemEvents: many(catalogItemEvents),
}));

export const supplierStoresRelations = relations(supplierStores, ({many}) => ({
	catalogStockNotifications: many(catalogStockNotifications),
	catalogStockReports: many(catalogStockReports),
	supplierStoreCategories: many(supplierStoreCategories),
	supplierCatalogItems: many(supplierCatalogItems),
	supplierStorePhotos: many(supplierStorePhotos),
	catalogItemEvents: many(catalogItemEvents),
	storeFollowers: many(storeFollowers),
}));

export const usersInAuthRelations = relations(usersInAuth, ({many}) => ({
	catalogStockNotifications: many(catalogStockNotifications),
	deviceTokens: many(deviceTokens),
	passwordResetCodes: many(passwordResetCodes),
	profiles: many(profiles),
}));

export const deviceTokensRelations = relations(deviceTokens, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [deviceTokens.userId],
		references: [usersInAuth.id]
	}),
}));

export const commentLikesRelations = relations(commentLikes, ({one}) => ({
	postComment: one(postComments, {
		fields: [commentLikes.commentId],
		references: [postComments.id]
	}),
}));

export const postCommentsRelations = relations(postComments, ({one, many}) => ({
	commentLikes: many(commentLikes),
	postComment: one(postComments, {
		fields: [postComments.parentId],
		references: [postComments.id],
		relationName: "postComments_parentId_postComments_id"
	}),
	postComments: many(postComments, {
		relationName: "postComments_parentId_postComments_id"
	}),
	post: one(posts, {
		fields: [postComments.postId],
		references: [posts.id]
	}),
	profile: one(profiles, {
		fields: [postComments.userId],
		references: [profiles.id]
	}),
}));

export const listingPhotosRelations = relations(listingPhotos, ({one}) => ({
	listing: one(listings, {
		fields: [listingPhotos.listingId],
		references: [listings.id]
	}),
}));

export const catalogStockReportsRelations = relations(catalogStockReports, ({one}) => ({
	supplierCatalogItem: one(supplierCatalogItems, {
		fields: [catalogStockReports.itemId],
		references: [supplierCatalogItems.id]
	}),
	supplierStore: one(supplierStores, {
		fields: [catalogStockReports.storeId],
		references: [supplierStores.id]
	}),
}));

export const messageThreadsRelations = relations(messageThreads, ({one, many}) => ({
	profile_participantA: one(profiles, {
		fields: [messageThreads.participantA],
		references: [profiles.id],
		relationName: "messageThreads_participantA_profiles_id"
	}),
	profile_participantB: one(profiles, {
		fields: [messageThreads.participantB],
		references: [profiles.id],
		relationName: "messageThreads_participantB_profiles_id"
	}),
	post: one(posts, {
		fields: [messageThreads.pinnedPostId],
		references: [posts.id]
	}),
	messages: many(messages),
}));

export const postsRelations = relations(posts, ({one, many}) => ({
	messageThreads: many(messageThreads),
	postComments: many(postComments),
	postPhotos: many(postPhotos),
	profile: one(profiles, {
		fields: [posts.userId],
		references: [profiles.id]
	}),
	postLikes: many(postLikes),
}));

export const portfolioPhotosRelations = relations(portfolioPhotos, ({one}) => ({
	profile: one(profiles, {
		fields: [portfolioPhotos.userId],
		references: [profiles.id]
	}),
}));

export const materialRequestPhotosRelations = relations(materialRequestPhotos, ({one}) => ({
	materialRequest: one(materialRequests, {
		fields: [materialRequestPhotos.requestId],
		references: [materialRequests.id]
	}),
}));

export const materialRequestsRelations = relations(materialRequests, ({many}) => ({
	materialRequestPhotos: many(materialRequestPhotos),
	materialRequestResponses: many(materialRequestResponses),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	listing: one(listings, {
		fields: [notifications.relatedListingId],
		references: [listings.id]
	}),
	project: one(projects, {
		fields: [notifications.relatedProjectId],
		references: [projects.id]
	}),
	profile_relatedUserId: one(profiles, {
		fields: [notifications.relatedUserId],
		references: [profiles.id],
		relationName: "notifications_relatedUserId_profiles_id"
	}),
	profile_userId: one(profiles, {
		fields: [notifications.userId],
		references: [profiles.id],
		relationName: "notifications_userId_profiles_id"
	}),
}));

export const projectsRelations = relations(projects, ({many}) => ({
	notifications: many(notifications),
	projectMessages: many(projectMessages),
	projectLogs: many(projectLogs),
	projectRatings: many(projectRatings),
}));

export const postPhotosRelations = relations(postPhotos, ({one}) => ({
	post: one(posts, {
		fields: [postPhotos.postId],
		references: [posts.id]
	}),
}));

export const materialRequestResponsesRelations = relations(materialRequestResponses, ({one}) => ({
	materialRequest: one(materialRequests, {
		fields: [materialRequestResponses.requestId],
		references: [materialRequests.id]
	}),
}));

export const lotteryDrawsRelations = relations(lotteryDraws, ({one, many}) => ({
	lotteryTicket: one(lotteryTickets, {
		fields: [lotteryDraws.winningTicketId],
		references: [lotteryTickets.id]
	}),
	prizeClaims: many(prizeClaims),
}));

export const lotteryTicketsRelations = relations(lotteryTickets, ({many}) => ({
	lotteryDraws: many(lotteryDraws),
}));

export const messagesRelations = relations(messages, ({one}) => ({
	profile: one(profiles, {
		fields: [messages.senderId],
		references: [profiles.id]
	}),
	messageThread: one(messageThreads, {
		fields: [messages.threadId],
		references: [messageThreads.id]
	}),
}));

export const passwordResetCodesRelations = relations(passwordResetCodes, ({one}) => ({
	usersInAuth: one(usersInAuth, {
		fields: [passwordResetCodes.userId],
		references: [usersInAuth.id]
	}),
}));

export const projectMessagesRelations = relations(projectMessages, ({one}) => ({
	project: one(projects, {
		fields: [projectMessages.projectId],
		references: [projects.id]
	}),
}));

export const projectLogsRelations = relations(projectLogs, ({one}) => ({
	project: one(projects, {
		fields: [projectLogs.projectId],
		references: [projects.id]
	}),
}));

export const projectRatingsRelations = relations(projectRatings, ({one}) => ({
	project: one(projects, {
		fields: [projectRatings.projectId],
		references: [projects.id]
	}),
}));

export const storyViewsRelations = relations(storyViews, ({one}) => ({
	story: one(stories, {
		fields: [storyViews.storyId],
		references: [stories.id]
	}),
	profile: one(profiles, {
		fields: [storyViews.viewerId],
		references: [profiles.id]
	}),
}));

export const storiesRelations = relations(stories, ({one, many}) => ({
	storyViews: many(storyViews),
	profile: one(profiles, {
		fields: [stories.userId],
		references: [profiles.id]
	}),
}));

export const rentalLikesRelations = relations(rentalLikes, ({one}) => ({
	rentalListing: one(rentalListings, {
		fields: [rentalLikes.rentalId],
		references: [rentalListings.id]
	}),
}));

export const rentalListingsRelations = relations(rentalListings, ({one, many}) => ({
	rentalLikes: many(rentalLikes),
	rentalPhotos: many(rentalPhotos),
	rentalComments: many(rentalComments),
	profile: one(profiles, {
		fields: [rentalListings.userId],
		references: [profiles.id]
	}),
}));

export const rentalPhotosRelations = relations(rentalPhotos, ({one}) => ({
	rentalListing: one(rentalListings, {
		fields: [rentalPhotos.listingId],
		references: [rentalListings.id]
	}),
}));

export const rentalCommentsRelations = relations(rentalComments, ({one, many}) => ({
	rentalComment: one(rentalComments, {
		fields: [rentalComments.parentId],
		references: [rentalComments.id],
		relationName: "rentalComments_parentId_rentalComments_id"
	}),
	rentalComments: many(rentalComments, {
		relationName: "rentalComments_parentId_rentalComments_id"
	}),
	rentalListing: one(rentalListings, {
		fields: [rentalComments.rentalId],
		references: [rentalListings.id]
	}),
	profile: one(profiles, {
		fields: [rentalComments.userId],
		references: [profiles.id]
	}),
	rentalCommentLikes: many(rentalCommentLikes),
}));

export const prizeClaimsRelations = relations(prizeClaims, ({one}) => ({
	lotteryDraw: one(lotteryDraws, {
		fields: [prizeClaims.drawId],
		references: [lotteryDraws.id]
	}),
}));

export const supplierStoreCategoriesRelations = relations(supplierStoreCategories, ({one}) => ({
	supplierCategory: one(supplierCategories, {
		fields: [supplierStoreCategories.categoryId],
		references: [supplierCategories.id]
	}),
	supplierStore: one(supplierStores, {
		fields: [supplierStoreCategories.storeId],
		references: [supplierStores.id]
	}),
}));

export const supplierCategoriesRelations = relations(supplierCategories, ({many}) => ({
	supplierStoreCategories: many(supplierStoreCategories),
	supplierCatalogItems: many(supplierCatalogItems),
	catalogProducts: many(catalogProducts),
}));

export const catalogProductsRelations = relations(catalogProducts, ({one, many}) => ({
	supplierCatalogItems: many(supplierCatalogItems),
	supplierCategory: one(supplierCategories, {
		fields: [catalogProducts.categoryId],
		references: [supplierCategories.id]
	}),
}));

export const userCategoriesRelations = relations(userCategories, ({one}) => ({
	category: one(categories, {
		fields: [userCategories.categoryId],
		references: [categories.id]
	}),
	profile: one(profiles, {
		fields: [userCategories.userId],
		references: [profiles.id]
	}),
}));

export const categoriesRelations = relations(categories, ({many}) => ({
	userCategories: many(userCategories),
	listingCategories: many(listingCategories),
}));

export const superUserIdentitiesRelations = relations(superUserIdentities, ({one}) => ({
	profile_identityUserId: one(profiles, {
		fields: [superUserIdentities.identityUserId],
		references: [profiles.id],
		relationName: "superUserIdentities_identityUserId_profiles_id"
	}),
	profile_masterUserId: one(profiles, {
		fields: [superUserIdentities.masterUserId],
		references: [profiles.id],
		relationName: "superUserIdentities_masterUserId_profiles_id"
	}),
}));

export const supplierStorePhotosRelations = relations(supplierStorePhotos, ({one}) => ({
	supplierStore: one(supplierStores, {
		fields: [supplierStorePhotos.storeId],
		references: [supplierStores.id]
	}),
}));

export const blogPostsRelations = relations(blogPosts, ({one}) => ({
	blogCategory: one(blogCategories, {
		fields: [blogPosts.categoryId],
		references: [blogCategories.id]
	}),
}));

export const blogCategoriesRelations = relations(blogCategories, ({many}) => ({
	blogPosts: many(blogPosts),
}));

export const catalogItemEventsRelations = relations(catalogItemEvents, ({one}) => ({
	supplierCatalogItem: one(supplierCatalogItems, {
		fields: [catalogItemEvents.itemId],
		references: [supplierCatalogItems.id]
	}),
	supplierStore: one(supplierStores, {
		fields: [catalogItemEvents.storeId],
		references: [supplierStores.id]
	}),
}));

export const listingCategoriesRelations = relations(listingCategories, ({one}) => ({
	category: one(categories, {
		fields: [listingCategories.categoryId],
		references: [categories.id]
	}),
	listing: one(listings, {
		fields: [listingCategories.listingId],
		references: [listings.id]
	}),
}));

export const rentalCommentLikesRelations = relations(rentalCommentLikes, ({one}) => ({
	rentalComment: one(rentalComments, {
		fields: [rentalCommentLikes.commentId],
		references: [rentalComments.id]
	}),
}));

export const postLikesRelations = relations(postLikes, ({one}) => ({
	post: one(posts, {
		fields: [postLikes.postId],
		references: [posts.id]
	}),
}));

export const storeFollowersRelations = relations(storeFollowers, ({one}) => ({
	supplierStore: one(supplierStores, {
		fields: [storeFollowers.storeId],
		references: [supplierStores.id]
	}),
}));

export const marketplaceItemsRelations = relations(marketplaceItems, ({one, many}) => ({
	profile: one(profiles, {
		fields: [marketplaceItems.userId],
		references: [profiles.id]
	}),
	marketplaceItemPhotos: many(marketplaceItemPhotos),
}));

export const marketplaceItemPhotosRelations = relations(marketplaceItemPhotos, ({one}) => ({
	marketplaceItem: one(marketplaceItems, {
		fields: [marketplaceItemPhotos.itemId],
		references: [marketplaceItems.id]
	}),
}));