import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Modal, Button, Form } from 'react-bootstrap';
import { db } from '../firebaseConfig';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { useAuth0 } from '@auth0/auth0-react';
import ProfilePictureUpload from './ProfilePictureUpload';
import PDFUpload from './PDFUpload';
import { s3 } from '../awsConfig';
import Select from 'react-select';
import Carousel from 'react-bootstrap/Carousel';

// Cache configuration
const CACHE_EXPIRATION = 5 * 60 * 1000; // 5 minutes

// Local storage helpers
const saveProfileToLocalStorage = (username, profileData) => {
  const dataToStore = {
    profile: profileData,
    timestamp: Date.now()
  };
  localStorage.setItem(`profile_${username}`, JSON.stringify(dataToStore));
};

const getProfileFromLocalStorage = (username) => {
  const storedData = localStorage.getItem(`profile_${username}`);
  if (storedData) {
    const { profile, timestamp } = JSON.parse(storedData);
    if (Date.now() - timestamp < CACHE_EXPIRATION) {
      return profile;
    }
  }
  return null;
};

// Interest options for select
const interestOptions = [
  { value: 'Technology', label: 'Technology' },
  { value: 'Healthcare', label: 'Healthcare' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Construction', label: 'Construction' },
  { value: 'Education', label: 'Education' },
  { value: 'Hospitality', label: 'Hospitality' },
  { value: 'Law', label: 'Law' },
  { value: 'Arts', label: 'Arts' }
];

const Profile = () => {

  const { user: auth0User, isAuthenticated } = useAuth0();
  const { username } = useParams();

  // Authentication and User States
  const [currentUser, setCurrentUser] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Profile Data States
  const [profilePicture, setProfilePicture] = useState(null);
  const [about, setAbout] = useState('');
  const [organization, setOrganization] = useState('');
  const [interests, setInterests] = useState('');
  const [selectedInterests, setSelectedInterests] = useState([]);

  // Follow States
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isRequestInProgress, setIsRequestInProgress] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);

  // PDF States
  const [pdfs, setPdfs] = useState([]);
  const [currentPdfIndex, setCurrentPdfIndex] = useState(0);
  const [contributionsCount, setContributionsCount] = useState(0);

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newAbout, setNewAbout] = useState('');
  const [newOrganization, setNewOrganization] = useState('');
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [pdfToRemove, setPdfToRemove] = useState(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedTags, setEditedTags] = useState([]);

  // UI States
  const [isHovering, setIsHovering] = useState(false);


  const fetchPDFs = useCallback(async (userId) => {
    if (!userId) {
      console.error('No userId provided to fetchPDFs');
      setPdfs([]);
      return;
    }

    try {
      const userDocRef = doc(db, 'users', userId);
      const userDoc = await getDoc(userDocRef);
      
      if (!userDoc.exists()) {
        console.log('No user document found');
        setPdfs([]);
        return;
      }

      const userData = userDoc.data();
      if (!userData?.pdfs?.length) {
        setPdfs([]);
        return;
      }

      const validPdfs = [];
      for (const pdfData of userData.pdfs) {
        try {
          const response = await fetch(pdfData.url, { method: 'HEAD' });
          if (response.ok) {
            validPdfs.push(pdfData);
          }
        } catch (error) {
          console.error("PDF no longer exists:", error);
        }
      }

      setPdfs(validPdfs);
    } catch (error) {
      console.error('Error fetching PDFs:', error);
      setPdfs([]);
    }
  }, []);

  const fetchProfileData = useCallback(async () => {
    if (!username) {
      setLoading(false);
      return;
    }

    try {
      const cachedProfile = getProfileFromLocalStorage(username);
      if (cachedProfile) {
        console.log("Profile found in local storage");
        setProfileUser(cachedProfile);
        setAbout(cachedProfile.about || '');
        setOrganization(cachedProfile.organization || '');
        setInterests(cachedProfile.interests || '');
        setProfilePicture(cachedProfile.profilePicture || null);
        if (cachedProfile.uid) {
          await fetchPDFs(cachedProfile.uid);
        }
        setLoading(false);
        return;
      }

      const usernamesRef = collection(db, 'usernames');
      const q = query(usernamesRef, where('username', '==', username.toLowerCase()));
      const querySnapshot = await getDocs(q);

      if (querySnapshot.empty) {
        setProfileUser(null);
        setLoading(false);
        return;
      }

      const userDoc = querySnapshot.docs[0].data();
      const userId = userDoc.userId;

      if (!userId) {
        setLoading(false);
        return;
      }

      const userDocRef = doc(db, 'users', userId);
      const userDocSnapshot = await getDoc(userDocRef);

      if (!userDocSnapshot.exists()) {
        setLoading(false);
        return;
      }

      const userData = userDocSnapshot.data();
      const profileData = {
        ...userData,
        uid: userId
      };

      setProfileUser(profileData);
      setProfilePicture(userData.profilePicture || null);
      setAbout(userData.about || '');
      setOrganization(userData.organization || '');
      setInterests(userData.interests || '');

      if (userData.interests) {
        const interestsArray = userData.interests.split(', ');
        setSelectedInterests(
          interestsArray.map(interest => ({ value: interest, label: interest }))
        );
      }

      saveProfileToLocalStorage(username, profileData);
      await fetchPDFs(userId);

    } catch (error) {
      console.error('Error fetching profile data:', error);
      setProfileUser(null);
    } finally {
      setLoading(false);
    }
  }, [username, fetchPDFs]);


  const updateProfilePicture = useCallback((newPictureUrl) => {
    if (!auth0User?.sub) return;

    setProfilePicture(newPictureUrl);
    setProfileUser(prev => {
      if (prev) {
        const updatedUser = { ...prev, profilePicture: newPictureUrl };
        saveProfileToLocalStorage(username, updatedUser);
        return updatedUser;
      }
      return null;
    });
  }, [username, auth0User]);

  const updateAbout = useCallback(async (newAboutSection) => {
    if (!profileUser || !auth0User?.sub || auth0User.sub !== profileUser.uid) return;

    try {
      const userDocRef = doc(db, 'users', auth0User.sub);
      await updateDoc(userDocRef, { about: newAboutSection });
      setAbout(newAboutSection);
      const updatedUser = { ...profileUser, about: newAboutSection };
      saveProfileToLocalStorage(username, updatedUser);
      setProfileUser(updatedUser);
    } catch (error) {
      console.error("Error updating about section:", error);
    }
  }, [username, profileUser, auth0User]);

  const updateOrganization = useCallback(async (newOrganizationSection) => {
    if (!profileUser || !auth0User?.sub || auth0User.sub !== profileUser.uid) return;

    try {
      const userDocRef = doc(db, 'users', auth0User.sub);
      await updateDoc(userDocRef, { organization: newOrganizationSection });
      setOrganization(newOrganizationSection);
      const updatedUser = { ...profileUser, organization: newOrganizationSection };
      saveProfileToLocalStorage(username, updatedUser);
      setProfileUser(updatedUser);
    } catch (error) {
      console.error("Error updating organization section:", error);
    }
  }, [username, profileUser, auth0User]);

  const updateInterests = useCallback(async (newInterests) => {
    if (!profileUser || !auth0User?.sub || auth0User.sub !== profileUser.uid) return;

    const interestValues = newInterests.map(interest => interest.value);
    setSelectedInterests(newInterests);
    const updatedUser = { ...profileUser, interests: interestValues.join(', ') };
    saveProfileToLocalStorage(username, updatedUser);
    setProfileUser(updatedUser);
    
    try {
      const userDocRef = doc(db, 'users', auth0User.sub);
      await updateDoc(userDocRef, { interests: interestValues.join(', ') });
      console.log("Interests updated in Firestore.");
    } catch (error) {
      console.error("Error updating interests in Firestore:", error);
    }
  }, [username, profileUser, auth0User]);

  const handleEdit = (pdf) => {
    if (!auth0User?.sub || !profileUser || auth0User.sub !== profileUser.uid) {
      return;
    }
    setPdfToRemove(pdf);
    setEditedTitle(pdf.title);
    setEditedDescription(pdf.description);
    setEditedTags(pdf.topics ? pdf.topics.map(topic => ({ value: topic, label: topic })) : []);
    setShowRemoveModal(true);
  };

  const saveChanges = async () => {
    if (!pdfToRemove || !auth0User?.sub) return;
    try {
      const userDocRef = doc(db, 'users', auth0User.sub);
      const updatedPdfs = pdfs.map(pdf => 
        pdf.url === pdfToRemove.url 
          ? { 
              ...pdf, 
              title: editedTitle, 
              description: editedDescription,
              topics: editedTags.map(tag => tag.value)
            } 
          : pdf
      );
      await updateDoc(userDocRef, { pdfs: updatedPdfs });
      setPdfs(updatedPdfs);
    } catch (error) {
      console.error("Error updating PDF:", error);
      alert("Failed to update PDF. Please try again.");
    } finally {
      setShowRemoveModal(false);
      setPdfToRemove(null);
    }
  };

  const confirmRemove = async () => {
    if (!pdfToRemove || !auth0User?.sub) return;

    try {
      const key = decodeURIComponent(pdfToRemove.url.split('resdex-bucket.s3.amazonaws.com/')[1]);
      const params = { Bucket: 'resdex-bucket', Key: key };
      await s3.deleteObject(params).promise();

      const userDocRef = doc(db, 'users', auth0User.sub);
      const updatedPdfs = pdfs.filter(pdf => pdf.url !== pdfToRemove.url);
      await updateDoc(userDocRef, { pdfs: updatedPdfs });

      setPdfs(updatedPdfs);
      if (currentPdfIndex >= updatedPdfs.length) {
        setCurrentPdfIndex(Math.max(0, updatedPdfs.length - 1));
      }
    } catch (error) {
      console.error("Error removing PDF:", error);
      alert("Failed to remove PDF. Please try again.");
    } finally {
      setShowRemoveModal(false);
      setPdfToRemove(null);
    }
  };

  useEffect(() => {
    fetchProfileData();
  }, [fetchProfileData]);




  
  useEffect(() => {
    console.log('Profile User Data:', profileUser);
    console.log('Research Papers:', profileUser?.research);
    console.log('Collaborations:', profileUser?.collaborations);
  }, [profileUser]);








  useEffect(() => {
    if (profileUser?.uid) {
      fetchPDFs(profileUser.uid);
    }
  }, [profileUser, fetchPDFs]);

  useEffect(() => {
    if (profileUser) {
      setContributionsCount(profileUser.contributions || 0);
    }
  }, [profileUser]);

  const handleProfilePictureClick = () => {
    document.getElementById('profilePictureInput').click();
  };

  const handleMouseEnter = () => setIsHovering(true);
  const handleMouseLeave = () => setIsHovering(false);

  const handleModalOpen = () => {
    setNewAbout(about);
    setNewOrganization(organization);
    const currentInterests = interests
      ? interests.split(', ').map(interest => ({ value: interest, label: interest }))
      : [];
    setSelectedInterests(currentInterests);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
  };

  const handleAboutSubmit = () => {
    if(newAbout !== about) {
      updateAbout(newAbout);
    }
    if(newOrganization !== organization) {
      updateOrganization(newOrganization);
    }
    const newInterestsString = selectedInterests.map(i => i.value).join(', ');
    if (newInterestsString !== interests) {
      updateInterests(selectedInterests);
    }
    setIsModalOpen(false);
  };

  if (loading) {
    return <p className='primary'>Loading...</p>;
  }

  if (!profileUser) {
    return <p>User not found.</p>;
  }

  const isOwnProfile = isAuthenticated && auth0User && auth0User.sub === profileUser?.uid;

  const customStyles = {
    option: (provided, state) => ({
      ...provided,
      color: state.isSelected ? 'white' : 'black',
      backgroundColor: state.isSelected ? 'rgba(189,197,209,.3)' : 'white',
      '&:hover': {
        backgroundColor: 'rgba(189,197,209,.3)',
      },
    }),
    multiValue: (provided) => ({
      ...provided,
      backgroundColor: '#1a1a1a',
      padding: '10px',
      margin: '1px',
      borderRadius: '5px'
    }),
    multiValueLabel: (provided) => ({
      ...provided,
      color: 'white',
    }),
    multiValueRemove: (provided) => ({
      ...provided,
      color: 'white',
      ':hover': {
        backgroundColor: '#1a1a1a',
        color: 'white',
      },
    }),
  };








  return (
    <div>
      <div className='row d-flex justify-content-center mt-3 fade-in' 
           style={{marginBottom: '20px'}}>
        <div className='row d-flex justify-content-center'>
          <div className='col-md-9 box' style={{padding: '20px'}}>
            {/* Edit Profile Button */}
            <div className='row d-flex justify-content-center'>
              <div className='col'>
                <div className='col-md' style={{position:'relative', textAlign: 'right'}}>                    
                  {isOwnProfile && (
                    <button className='custom-edit' onClick={handleModalOpen}> 
                      <svg style={{marginRight: '14px'}} xmlns="http://www.w3.org/2000/svg" width="20" height="20" className="bi bi-pencil-square" fill="white" viewBox="0 0 16 16">
                        <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
                        <path fillRule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z"/>
                      </svg>
                      Edit Profile
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Profile Picture Section */}
            <div 
              style={{
                width: '150px',
                height: '150px',
                borderRadius: '5%',
                position: 'relative',
                overflow: 'hidden',
                backgroundColor: '#ccc',
                cursor: isOwnProfile ? 'pointer' : 'default',
              }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onClick={isOwnProfile ? handleProfilePictureClick : undefined}
            >
              {profilePicture ? (
                <img
                  src={profilePicture}
                  alt="Profile"
                  style={{
                    width: '150px',
                    height: '150px',
                    objectFit: 'cover'
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '150px',
                    height: '150px',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  No Image
                </div>
              )}
              {isOwnProfile && isHovering && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    color: 'white',
                    fontWeight: 'bold'
                  }}
                >
                  Change Picture
                </div>
              )}
            </div>

            {/* Profile Information */}
            <div className='row'>
              <div className='col-md'>
                <h1 className='primary mt-4'>
                  {profileUser.fullName}
                  {(username === "dev" || username === "fenil" || username === "deep" || username === "rishi" || username === "bhavi") && (
                    <svg style={{ marginLeft: '20px' }} xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="black" className="bi bi-patch-check-fill" viewBox="0 0 16 16" title="Verified user">
                      <path d="M10.067.87a2.89 2.89 0 0 0-4.134 0l-.622.638-.89-.011a2.89 2.89 0 0 0-2.924 2.924l.01.89-.636.622a2.89 2.89 0 0 0 0 4.134l.637.622-.011.89a2.89 2.89 0 0 0 2.924 2.924l.89-.01.622.636a2.89 2.89 0 0 0 4.134 0l.622-.637.89.011a2.89 2.89 0 0 0 2.924-2.924l-.01-.89.636-.622a2.89 2.89 0 0 0 0-4.134l-.637-.622.011-.89a2.89 2.89 0 0 0-2.924-2.924l-.89.01zm.287 5.984-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L7 8.793l2.646-2.647a.5.5 0 0 1 .708.708"/>
                    </svg>
                  )}
                </h1>
              </div>
            </div>

            {/* About Section */}
            <p className='primary'>{about}</p>

            {/* Organization and Interests */}
            <div className='row d-flex justify-content-center' style={{margin: '0px'}}>
              <div className='col-md-5 box' style={{
                textAlign: 'left', 
                borderLeft: '1px solid white', 
                marginTop: '10px', 
                marginBottom: '20px', 
                padding: '20px', 
                margin: '5px'
              }}>
                {organization && (
                  <p className='primary'>
                    <svg style={{marginRight: '10px'}} xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="primary" className="bi bi-buildings" viewBox="0 0 16 16">
                      <path d="M14.763.075A.5.5 0 0 1 15 .5v15a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5V14h-1v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V10a.5.5 0 0 1 .342-.474L6 7.64V4.5a.5.5 0 0 1 .276-.447l8-4a.5.5 0 0 1 .487.022M6 8.694 1 10.36V15h5zM7 15h2v-1.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5V15h2V1.309l-7 3.5z"/>
                      <path d="M2 11h1v1H2zm2 0h1v1H4zm-2 2h1v1H2zm2 0h1v1H4zm4-4h1v1H8zm2 0h1v1h-1zm-2 2h1v1H8zm2 0h1v1h-1zm2-2h1v1h-1zm0 2h1v1h-1zM8 7h1v1H8zm2 0h1v1h-1zm2 0h1v1h-1zM8 5h1v1H8zm2 0h1v1h-1zm2 0h1v1h-1zm0-2h1v1h-1z"/>
                    </svg>
                    {organization}
                  </p>
                )}

                {interests && interests.length > 0 && (
                  <div>
                    <svg style={{marginRight: '10px'}} xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="primary" className="bi bi-tags-fill" viewBox="0 0 16 16">
                      <path d="M2 2a1 1 0 0 1 1-1h4.586a1 1 0 0 1 .707.293l7 7a1 1 0 0 1 0 1.414l-4.586 4.586a1 1 0 0 1-1.414 0l-7-7A1 1 0 0 1 2 6.586zm3.5 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"/>
                      <path d="M1.293 7.793A1 1 0 0 1 1 7.086V2a1 1 0 0 0-1 1v4.586a1 1 0 0 0 .293.707l7 7a1 1 0 0 0 1.414 0l.043-.043z"/>
                    </svg>
                    {interests.split(', ').map((interest, index) => (
                      <span key={index} className="interest-pill">
                        {interest}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

          

          </div>

          
        </div>


        
      </div>

      <div className='mt-5' style={{marginLeft: '150px', marginRight: '150px'}}>
  <div style={{borderRadius: '5px', margin: '0px'}} className='row d-flex justify-content-center'>
    <div className='col-md-12 box'>
      <div className='row' style={{marginTop: "-10px"}}>
        <div className='col-md d-flex align-items-center'>
          <h4 className='primary p-2'>Shared Projects</h4>
        </div>
      </div>

      <div style={{
        borderRadius: '5px',
        padding: '20px',
        paddingBottom: '50px',
        border: '1px solid white',
        marginBottom: '10px',
      }} className='row justify-content-center align-items-center'>
        {profileUser.research && profileUser.research.length > 0 ? (
          // Sort papers by date and map through them
          [...profileUser.research]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map((paper, index) => (
              <div key={index} style={{
                marginBottom: index !== profileUser.research.length - 1 ? '30px' : '0',
                borderBottom: index !== profileUser.research.length - 1 ? '1px solid #1a1a1a' : 'none',
                paddingBottom: '30px'
              }}>
                <div style={{
                  marginLeft:'150px',
                  marginRight:'150px'
                }} className='d-flex justify-content-center'>
                  <div className='row mt-3' style={{ width: '100%' }}>
                    <div className="text-white mt-3" style={{borderLeft: '1px solid #1a1a1a', paddingLeft: '30px'}}>
                      <h5 className='primary'>{paper.title}</h5>
                      <p className='primary'>{paper.description}</p>

                      {/* Topics */}
                      {paper.topics && paper.topics.length > 0 && (
                        <div style={{ marginBottom: '10px' }}>
                          <svg style={{marginRight: '10px'}} xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="primary" className="bi bi-tags-fill" viewBox="0 0 16 16">
                            <path d="M2 2a1 1 0 0 1 1-1h4.586a1 1 0 0 1 .707.293l7 7a1 1 0 0 1 0 1.414l-4.586 4.586a1 1 0 0 1-1.414 0l-7-7A1 1 0 0 1 2 6.586zm3.5 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3"/>
                            <path d="M1.293 7.793A1 1 0 0 1 1 7.086V2a1 1 0 0 0-1 1v4.586a1 1 0 0 0 .293.707l7 7a1 1 0 0 0 1.414 0l.043-.043z"/>
                          </svg>
                          {paper.topics.map((topic, idx) => (
                            <span key={idx} className="interest-pill">
                              {topic}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Collaborators */}
                      {paper.collaborators && paper.collaborators.length > 0 && (
                        <div style={{ marginBottom: '20px' }}>
                          <h6 className='primary'>Collaborators:</h6>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {paper.collaborators.map((collaborator, idx) => (
                              <div key={idx} style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                background: '#1a1a1a',
                                padding: '5px 10px',
                                borderRadius: '20px'
                              }}>
                                <img
                                  src={collaborator.profilePicture || 'https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_1280.png'}
                                  alt={collaborator.name}
                                  style={{
                                    width: '25px',
                                    height: '25px',
                                    borderRadius: '50%',
                                    marginRight: '8px'
                                  }}
                                />
                                <span className='primary'>{collaborator.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Created Date */}
                      <small className='primary' style={{ opacity: 0.7 }}>
                        Created: {new Date(paper.createdAt).toLocaleDateString()}
                      </small>
                    </div>
                  </div>
                </div>
              </div>
            ))
        ) : (
          <div className="text-center primary" style={{marginTop: '40px'}}>
            No Research Papers Created
          </div>
        )}
      </div>
    </div>
  </div>
</div>


      {/* Profile Picture Upload */}
      {isOwnProfile && (
        <ProfilePictureUpload
          user={auth0User}
          updateProfilePicture={updateProfilePicture}
          id="profilePictureInput"
          style={{ display: 'none' }}
        />
      )}







            {/* Edit Profile Modal */}
            <Modal show={isModalOpen} onHide={handleModalClose} className='box'>
        <Modal.Header style={{background: '#e5e3df', borderBottom: '1px solid white'}} closeButton>
          <Modal.Title className='primary'>Edit Profile</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{background: '#e5e3df', borderBottom: '1px solid white'}}>
          {/* About Section */}
          <div style={{borderBottom: '1px solid white', paddingBottom: '20px'}}>
            <p><strong className='primary'>About</strong></p>
            <textarea
              spellCheck="false"
              maxLength="300"
              value={newAbout}
              onChange={(e) => setNewAbout(e.target.value)}
              rows="6"
              style={{ 
                width: '100%', 
                color: 'black', 
                borderRadius: '5px', 
                resize: "none", 
                padding:'20px' 
              }}
            />
          </div>
          <br />

          {/* Organization Section */}
          <div style={{borderBottom: '1px solid white', paddingBottom: '20px'}}>
            <p><strong className='primary'>Organization</strong></p>
            <textarea
              spellCheck="false"
              maxLength="40"
              value={newOrganization}
              onChange={(e) => setNewOrganization(e.target.value)}
              rows="1"
              style={{ 
                width: '100%', 
                color: 'black', 
                borderRadius: '5px', 
                resize: "none", 
                padding:'20px' 
              }}
            />
          </div>
          <br />

          {/* Interests Section */}
          <p><strong className='primary'>Interests</strong></p>
          <Select
            isMulti
            name="interests"
            options={interestOptions}
            className="basic-multi-select"
            classNamePrefix="select"
            value={selectedInterests}
            rows='1'
            onChange={(selected) => {
              if (selected.length <= 3) {
                setSelectedInterests(selected);
              }
            }}
            isOptionDisabled={() => selectedInterests.length >= 3}
            placeholder="Select up to 3 interests"
            styles={customStyles}
          />
          <br />
        </Modal.Body>
        <Modal.Footer style={{background: '#e5e3df', borderBottom: '1px solid white'}}>
          <a className='custom-view' onClick={handleModalClose}>
            Cancel
          </a>
          <a className='custom-view' onClick={handleAboutSubmit}>
            Save
          </a>
        </Modal.Footer>
      </Modal>

      {/* Edit Document Modal */}
      <Modal show={showRemoveModal} className='box' onHide={() => setShowRemoveModal(false)}>
        <Modal.Header style={{background: '#e5e3df', borderBottom: '1px solid white'}} closeButton>
          <Modal.Title style={{color: 'black'}}>Edit Document</Modal.Title>
        </Modal.Header>
        <Modal.Body style={{background: '#e5e3df', borderBottom: '1px solid white'}}>
          <Form style={{background: '#e5e3df', borderBottom: '1px solid white'}}>
            <Form.Group className="mb-3" controlId="formDocumentTitle">
              <Form.Label className='primary'>Title</Form.Label>
              <Form.Control 
                type="text" 
                placeholder="Enter new title" 
                value={editedTitle} 
                onChange={(e) => setEditedTitle(e.target.value)} 
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="formDocumentDescription">
              <Form.Label className='primary'>Description</Form.Label>
              <Form.Control 
                as="textarea" 
                rows={3} 
                maxLength={150} 
                placeholder="Enter new description" 
                value={editedDescription} 
                onChange={(e) => setEditedDescription(e.target.value)} 
              />
            </Form.Group>
            <Form.Group className="mb-3" controlId="formDocumentTags">
              <Form.Label className='primary'>Related Topic</Form.Label>
              <Select
                isMulti
                name="tags"
                options={interestOptions}
                className="basic-multi-select"
                classNamePrefix="select"
                value={editedTags}
                onChange={(selected) => {
                  if (selected.length <= 3) {
                    setEditedTags(selected);
                  }
                }}
                isOptionDisabled={() => editedTags.length >= 3}
                placeholder="Select a topic!"
                styles={customStyles}
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer style={{background: '#e5e3df', borderBottom: '1px solid white'}}>
          <Button className='custom-view' onClick={confirmRemove}>
            Remove
          </Button>
          <div className="ms-auto">
            <Button className='custom-view' onClick={saveChanges}>
              Save Changes
            </Button>
          </div>
        </Modal.Footer>
      </Modal>

    </div>



  );
};




export default Profile;